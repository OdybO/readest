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
import { ODYBO_SYSTEM_PROMPT } from './prompt';
import { PREFETCH_PARALLEL, getSettings } from './settings';
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
  kind: 'chunk' | 'sent';
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

const userPrompt = (book: string, u: Unit) =>
  u.kind === 'chunk'
    ? `书名或文章：${book}\n\n选中的内容：${u.text}\n\n所在句子：${u.sentence}\n\n所在段落：${u.para}\n\n` +
      '（选中的是长句里的一截。请结合整句理解：【翻译】只翻译这一截；【句子拆解】说明这一截在整句里的作用，以及它和前后部分怎么连起来）'
    : `书名或文章：${book}\n\n选中的内容：${u.text}\n\n所在段落：${u.para}`;

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
  const key = prefetchKey(book, u.text);
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
  const outer = all.filter((r) => contains(n(r.text), ns));
  if (!outer.length) return null;
  const r = outer.reduce((a, b) => (n(a.text).length <= n(b.text).length ? a : b));
  if (ns.split(' ').length < 0.5 * n(r.text).split(' ').length) return null;
  return {
    answer: await withWhole(r),
    note: `预读 · 你选的是这一截的一部分，下面是整截「${r.text.split(/\s+/).slice(0, 5).join(' ')}…」的解释`,
  };
};

/** 一截的答案后面附上：整句原文 + 整句翻译（取自整句的预读，没有就不附）。 */
const wholeSentenceTail = async (book: string, sentence: string) => {
  const whole = await getRecord<PrefetchRecord>(PREFETCH, prefetchKey(book, sentence));
  const m = whole?.answer.match(/【翻译】\s*([\s\S]*?)(?=\n\s*【|$)/);
  if (!m || !m[1]!.trim()) return '';
  return `\n【整句原文】${sentence}\n【整句翻译】${m[1]!.replace(/\s+/g, ' ').trim()}`;
};
