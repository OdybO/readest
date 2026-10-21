// 预读：照电脑小工具（ctx_lookup.py 的 rolling_prefetch / reading_units / prefetch_find）。
// 在开了「本书自动预读」的书里查过东西后，后台把选中位置往后 3 截提前查好，存进本机（history.ts 的 prefetch）。
// 一截 = 一个意群：短句（不超过设置里的「短句长度」，默认 20 个词）整句一截；长句在逗号、分号等处切成 8～20 词的几截，整句也另外预读一份。
// 只预读句子和截，不预读单个的词（单词预读以后专门讨论）。
import type { CustomTranslator } from '@/types/translation';
import {
  createChatModel,
  loadSDK,
  stripReasoning,
} from '@/services/translators/custom/openaiCompatible';
import { ODYBO_SYSTEM_PROMPT, buildChunkPrompt } from './prompt';
import { PREFETCH_PARALLEL, getSettings } from './settings';
import { vocabForPrefetch, type VocabEntry } from './vocab';
import { remarkOpenDocs } from './marks';
import {
  PREFETCH,
  getRecord,
  listByBook,
  normalizeForKey as n,
  prefetchKey,
  putRecord,
  type PrefetchRecord,
} from './history';

// 往后预读几截、同时几个请求：在「语境查词」设置页里改（settings.ts），默认都是 3，和小工具一样

// ---------- 本书自动预读的开关（每本书单独记，默认关，和小工具一样） ----------

const toggleKey = (book: string) => `odybo.autoPrefetch.${n(book)}`;
export const isAutoPrefetch = (book: string) => {
  if (getSettings().prefetchAllBooks) return true;
  try {
    return localStorage.getItem(toggleKey(book)) === '1';
  } catch {
    return false;
  }
};
export const setAutoPrefetch = (book: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(toggleKey(book), '1');
    else localStorage.removeItem(toggleKey(book));
  } catch {
    // 存不了就只在这次打开时有效
  }
};

// ---------- 切句、切意群 ----------

const ABBREV = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'jr',
  'sr',
  'no',
]);

/** 一段拆成句子：. ! ? 后面跟空格和大写字母（或引号、括号）处断；Mr. 这类缩写不断。少于 3 个词的不要。 */
export const splitSentences = (para: string) => {
  const p = para.replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  let start = 0;
  const re = /[.!?]["”’)]?\d{0,3}\s+(?=[A-Z"“‘(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    const prev = p.slice(start, m.index + 1).match(/([A-Za-z.]+)[.!?]$/);
    if (prev && ABBREV.has(prev[1]!.toLowerCase().replace(/\.$/, ''))) continue;
    parts.push(p.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  parts.push(p.slice(start).trim());
  return parts.filter((s) => s.split(/\s+/).length >= 3);
};

const STARTERS = new Set(
  'and but or so yet which who whom whose where when while because although though including that if unless as'.split(
    ' ',
  ),
);

/** 长句切成意群：凑够 8 个词后遇到逗号、分号、冒号、破折号就断；太长还没断，就在 and / which 这类词前面断。 */
export const splitChunks = (sent: string, minW = 8, maxW = 20) => {
  const words = sent.split(/\s+/);
  if (words.length <= getSettings().shortSentenceWords) return [sent];
  const chunks: string[] = [];
  let cur: string[] = [];
  words.forEach((w, i) => {
    const next = (words[i + 1] || '').toLowerCase().replace(/^["“”‘’(]+/, '');
    cur.push(w);
    const atPunct = /[,;:—–]$/.test(w) || ['—', '–', '-'].includes(w);
    const tooLong = cur.length >= maxW + 4 && STARTERS.has(next);
    if ((cur.length >= minW && atPunct) || tooLong) {
      chunks.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) {
    if (chunks.length && cur.length < 5) chunks[chunks.length - 1] += ` ${cur.join(' ')}`;
    else chunks.push(cur.join(' '));
  }
  return chunks.length > 1 ? chunks : [sent];
};

interface Unit {
  para: string;
  sentence: string;
  text: string;
  kind: 'chunk' | 'sent' | 'word';
  /** 这一截里出现的生词（原形），提醒 AI 一定解释（照小工具的 vocab_hint） */
  hint?: string[];
}

/** 一段的阅读单位，按顺序。 */
export const readingUnits = (para: string): Unit[] =>
  splitSentences(para).flatMap((s): Unit[] => {
    const cs = splitChunks(s);
    return cs.length > 1
      ? cs.map((c) => ({ para, sentence: s, text: c, kind: 'chunk' as const }))
      : [{ para, sentence: s, text: s, kind: 'sent' as const }];
  });

// ---------- 发给 AI（和自己选中这段文字查一样，同一个提示词） ----------

const vocabHint = (u: Unit) =>
  u.hint?.length
    ? `\n\n（读者以前查过、还没记住这些词，这里出现了，请在【词组短语】或【难点】里一定解释：${u.hint.join('、')}）`
    : '';

const userPrompt = (book: string, u: Unit) =>
  u.kind === 'chunk'
    ? buildChunkPrompt(book, u.text, u.sentence, u.para, vocabHint(u))
    : `书名或文章：${book}\n\n选中的内容：${u.text}\n\n所在段落：${u.para}${u.kind === 'sent' ? vocabHint(u) : ''}`;

/** 存进本机的键：句子和截按内容；生词按「这个词 + 所在句」（同一个词在别的句子里是另一份） */
const unitKey = (book: string, u: Unit) =>
  u.kind === 'word' ? prefetchKey(book, `${u.text} | ${u.sentence}`) : prefetchKey(book, u.text);

const running = new Set<string>();
let active = 0;
const waiters: (() => void)[] = [];
const acquire = async () => {
  while (active >= PREFETCH_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  active++;
};
const release = () => {
  active--;
  waiters.shift()?.();
};

const prefetchUnit = async (
  translator: CustomTranslator,
  book: string,
  u: Unit,
  promptVersion: string,
): Promise<boolean> => {
  const key = unitKey(book, u);
  if (running.has(key)) return false;
  running.add(key);
  try {
    if (await getRecord<PrefetchRecord>(PREFETCH, key)) return false;
    await acquire();
    try {
      const [{ generateText }] = await loadSDK();
      const { text } = await generateText({
        model: await createChatModel(translator),
        system: ODYBO_SYSTEM_PROMPT,
        prompt: userPrompt(book, u),
        temperature: translator.temperature ?? 0.2,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const answer = stripReasoning(text);
      if (!answer) return false;
      const rec: PrefetchRecord = {
        key,
        book,
        text: u.text,
        kind: u.kind,
        sentence: u.sentence,
        para: u.para,
        answer,
        model: translator.model ?? '',
        promptVersion,
        createdAt: Date.now(),
      };
      await putRecord(PREFETCH, rec);
      return true;
    } finally {
      release();
    }
  } catch (e) {
    console.warn('[odybo] 预读失败', u.text.slice(0, 40), e);
    return false;
  } finally {
    running.delete(key);
  }
};

export interface PrefetchProgress {
  total: number;
  done: number;
  added: number;
}

/**
 * 从选中处往后预读：所在段落里选中内容结尾落在哪一截，就从那一截（没整个选中）或下一截（整个选中了）开始，
 * 往后「设置里的截数」截，不够就接着数下一段；其中长句的截，整句也加一份。
 * context：整段上下文（段与段之间空一行）；at：选中处在 context 里的位置。
 */
export const rollingPrefetch = async (opts: {
  translator: CustomTranslator;
  book: string;
  context: string;
  at: number;
  selection: string;
  promptVersion: string;
  onProgress?: (p: PrefetchProgress) => void;
}) => {
  const { context, at, selection } = opts;
  // 找出选中处所在的段落，以及它后面的段落
  const paras: { text: string; start: number }[] = [];
  let pos = 0;
  for (const p of context.split('\n\n')) {
    paras.push({ text: p, start: pos });
    pos += p.length + 2;
  }
  let pi = paras.findIndex((p) => at >= p.start && at <= p.start + p.text.length);
  if (pi < 0) pi = 0;
  const here = paras.slice(pi);
  const seq: (Unit & { from: number; to: number })[] = [];
  for (const [k, p] of here.entries()) {
    let cursor = 0;
    for (const u of readingUnits(p.text)) {
      const i = p.text.indexOf(u.text.slice(0, 30), cursor);
      const from = i >= 0 ? i : cursor;
      cursor = from + u.text.length;
      seq.push({
        ...u,
        from: k === 0 ? p.start + from : Infinity,
        to: k === 0 ? p.start + cursor : Infinity,
      });
    }
  }
  if (!seq.length) return;
  const selStart = at;
  const selEnd = at + selection.length;
  let last = 0;
  seq.forEach((u, i) => {
    if (u.from < selEnd) last = i;
  });
  const covered = selStart <= seq[last]!.from + 1 && selEnd >= seq[last]!.to - 1;
  const picked = seq.slice(covered ? last + 1 : last, last + 1 + getSettings().prefetchAhead);
  // 长句的截：整句也预读一份（放在前面，截的答案会附上整句翻译）
  const units: Unit[] = [];
  const wholes = new Set<string>();
  for (const u of picked) {
    if (u.kind === 'chunk' && !wholes.has(u.sentence)) {
      wholes.add(u.sentence);
      units.push({ para: u.para, sentence: u.sentence, text: u.sentence, kind: 'sent' });
    }
    units.push(u);
  }
  const skip = n(selection);
  // 生词预读：这几截里出现了生词本前 N 个（最近 D 天）里的词，就另外预读「这个词在这一句里」，每次最多 M 个
  const st = getSettings();
  if (st.vocabPrefetch && st.vocabPerRun > 0) {
    const entries = await vocabForPrefetch(st.vocabTop, st.vocabDays);
    const words: Unit[] = [];
    const seen = new Set<string>();
    for (const u of units) {
      const found = findVocab(u.text, entries);
      if (found.length) u.hint = [...new Set(found.map((f) => f.lemma))];
      for (const f of found) {
        const k = `${n(f.surface)}|${n(u.sentence)}`;
        if (seen.has(k) || n(f.surface) === skip || words.length >= st.vocabPerRun) continue;
        seen.add(k);
        words.push({ para: u.para, sentence: u.sentence, text: f.surface, kind: 'word' });
      }
    }
    units.push(...words);
  }
  const todo = units.filter((u) => n(u.text) !== skip);
  const progress: PrefetchProgress = { total: todo.length, done: 0, added: 0 };
  opts.onProgress?.({ ...progress });
  await Promise.all(
    todo.map(async (u) => {
      const added = await prefetchUnit(opts.translator, opts.book, u, opts.promptVersion);
      progress.done++;
      if (added) progress.added++;
      opts.onProgress?.({ ...progress });
    }),
  );
  if (progress.added) remarkOpenDocs(opts.book); // 新预读到的生词，在书里标出来
};

// ---------- 选中的文字有没有预读过 ----------

const contains = (big: string, small: string) => ` ${big} `.includes(` ${small} `);

/**
 * 1. 正好是预读过的一截或一句（不管空格、标点、大小写）
 * 2. 选的是某一截（或某一句）的一部分（至少一半）：给出那一截的解释
 * 不到 3 个词的不算（单个词不预读）。返回答案和底部说明。
 */
export const findPrefetched = async (book: string, selection: string) => {
  const ns = n(selection);
  if (ns.split(' ').length < 3) return null;
  const exact = await getRecord<PrefetchRecord>(PREFETCH, prefetchKey(book, selection));
  const withWhole = async (r: PrefetchRecord) =>
    r.kind === 'chunk' ? r.answer + (await wholeSentenceTail(book, r.sentence)) : r.answer;
  if (exact) return { answer: await withWhole(exact), note: '预读' };
  const all = await listByBook<PrefetchRecord>(PREFETCH, book);
  const outer = all.filter((r) => r.kind !== 'word' && contains(n(r.text), ns));
  if (!outer.length) return null;
  const r = outer.reduce((a, b) => (n(a.text).length <= n(b.text).length ? a : b));
  if (ns.split(' ').length < 0.5 * n(r.text).split(' ').length) return null;
  return {
    answer: await withWhole(r),
    note: `预读 · 你选的是这一截的一部分，下面是整截「${r.text.split(/\s+/).slice(0, 5).join(' ')}…」的解释`,
  };
};

// ---------- 生词预读 ----------

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 一个词（或短语）允许常见变形：play → plays / played / playing；短语每个词都允许（照小工具的 word_re） */
const formRe = (phrase: string) =>
  new RegExp(
    `\\b${phrase
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => {
        const base = w.endsWith('e') && w.length > 3 ? w.slice(0, -1) : w;
        return `(?:${escRe(w)}|${escRe(base)}(?:s|es|ed|d|ing))`;
      })
      .join('\\s+')}\\b`,
    'i',
  );

/** 这段文字里出现了哪些生词：返回原形和在文字里的实际写法。查过的写法（forms）和原形都试。 */
export const findVocab = (text: string, entries: VocabEntry[]) => {
  const out: { lemma: string; surface: string }[] = [];
  for (const e of entries) {
    for (const cand of [...e.forms, e.lemma]) {
      if (!cand.trim()) continue;
      const m = text.match(formRe(cand));
      if (m) {
        out.push({ lemma: e.lemma, surface: m[0] });
        break;
      }
    }
  }
  return out;
};

/** 选中的单词有没有按生词预读过：同一本书、同一个词、同一句（两边切句子的方式可能稍有不同，互相包含就算）。 */
export const findPrefetchedWord = async (book: string, word: string, sentence: string) => {
  const nw = n(word);
  const ns = n(sentence);
  if (!nw || !ns) return null;
  const all = await listByBook<PrefetchRecord>(PREFETCH, book);
  const r = all.find(
    (x) =>
      x.kind === 'word' &&
      n(x.text) === nw &&
      (n(x.sentence).includes(ns) || ns.includes(n(x.sentence))),
  );
  return r ? { answer: r.answer, note: '预读（生词）' } : null;
};

/** 一截的答案后面附上：整句原文 + 整句翻译（取自整句的预读，没有就不附）。 */
const wholeSentenceTail = async (book: string, sentence: string) => {
  const whole = await getRecord<PrefetchRecord>(PREFETCH, prefetchKey(book, sentence));
  const m = whole?.answer.match(/【翻译】\s*([\s\S]*?)(?=\n\s*【|$)/);
  if (!m || !m[1]!.trim()) return '';
  return `\n【整句原文】${sentence}\n【整句翻译】${m[1]!.replace(/\s+/g, ' ').trim()}`;
};
