// 预读：照电脑小工具（ctx_lookup.py 的 rolling_prefetch / reading_units / prefetch_find）。
// 在开了「本书句子预读」的书里查过东西后，后台把选中位置往后 3 截提前查好，存进本机（history.ts 的 prefetch）。
// 生词预读另有开关（底栏「生词预读」），10-23 起和句子预读分开：没开句子预读也照样预读生词。
// 一截 = 一个意群：短句（不超过设置里的「短句长度」，默认 20 个词）整句一截；长句在逗号、分号等处切成 8～20 词的几截，整句也另外预读一份。
// 生词另外预读（10-23 起改成短问）：同一段里出现的生词合成一次，用短提示词只问音标、这里的意思、原形、构词，
// 每个词附所在句和前后各一句，不发整段；收到的一行改写成和查词一样的栏目再存，卡片、书里标注、生词本照旧用。
import type { CustomTranslator } from '@/types/translation';
import {
  createChatModel,
  loadSDK,
  stripReasoning,
} from '@/services/translators/custom/openaiCompatible';
import {
  buildChunkPrompt,
  buildUserPrompt,
  buildVocabPrompt,
  markAt,
  occKey,
  occurrences,
  systemFor,
} from './prompt';
import { getPrompts } from './remotePrompts';
import { PREFETCH_PARALLEL, getSettings } from './settings';
import { vocabForPrefetch, type VocabEntry } from './vocab';
import { sentenceDifficulty } from './sentenceDifficulty';
import { remarkOpenDocs } from './marks';
import type { AheadBlock } from './selection';
import {
  HISTORY,
  PREFETCH,
  getRecord,
  historyKey,
  listByBook,
  normalizeForKey as n,
  prefetchKey,
  putRecord,
  type PrefetchRecord,
} from './history';

// 往后预读几截、同时几个请求：在「语境查词」设置页里改（settings.ts），默认都是 3，和小工具一样

// ---------- 本书句子预读的开关（每本书单独记，默认关，和小工具一样；原来叫「本书自动预读」） ----------

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
  /** 所在整句的难度分和理由（只挑难句时才有） */
  score?: number;
  reasons?: string[];
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

// 提示词用 WebDAV 上的那份（有的话，remotePrompts.ts）
const vocabHint = (u: Unit) =>
  u.hint?.length ? `\n\n${getPrompts().vocabHint.replace('{words}', u.hint.join('、'))}` : '';

// 段落里用 ⟦ ⟧ 括出这一截（和自己选中查一样，10-24）
const markedPara = (u: Unit) => markAt(u.para, u.text, Math.max(0, u.para.indexOf(u.text)));

const userPrompt = (book: string, u: Unit) =>
  u.kind === 'chunk'
    ? buildChunkPrompt(book, u.text, u.sentence, markedPara(u), vocabHint(u), getPrompts().chunk)
    : buildUserPrompt(book, u.text, markedPara(u)) + (u.kind === 'sent' ? vocabHint(u) : '');

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
        // 句子预读只问整句和长句的一截：只发句子格式的说明（乙，10-24）
        system: systemFor(getPrompts().system, 'sentence'),
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
        ...(u.score !== undefined ? { score: u.score, reasons: u.reasons } : {}),
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

// ---------- 生词预读：一段里的几个生词合成一次问（短提示词） ----------

interface VocabItem {
  para: string;
  sentence: string;
  /** 生词在句子里的实际写法 */
  text: string;
  /** 前一句、后一句（可以跨段，没有就空） */
  prev: string;
  next: string;
  /** 是所在句里的第几个（同一句里出现不止一次时分开问、分开存，10-24） */
  nth: number;
}

/** 短答案的一行「编号. 词 | 音标 | 这里的意思 | 原形 | 构词」，按编号取出各栏 */
export const parseVocabRows = (answer: string) => {
  const rows = new Map<number, string[]>();
  for (const line of answer.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、．]\s*(.+)$/);
    if (!m) continue;
    const parts = m[2]!.split('|').map((x) => x.trim());
    if (parts.length >= 4) rows.set(Number(m[1]), parts);
  }
  return rows;
};

/** 改写成和查词一样的栏目：开头音标行，【这里的意思】【原形】【构词】（render.ts、marks.ts、vocab.ts 照旧认） */
export const vocabRowToAnswer = (parts: string[]) => {
  const [, phon = '', meaning = '', lemma = '', ...rest] = parts;
  const wordParts = rest.join(' | ').trim() || '无';
  return `${phon}\n【这里的意思】${meaning}\n【原形】${lemma}\n【构词】${wordParts}`;
};

/** 是不是生词预读的短答案（只有这里的意思、原形、构词，没有为什么、整句翻译）：卡片上给「完整解释」按钮。
 * 用上以后记进「自己查过的」那份也是短的，所以按内容认，不靠预读记录的 short。 */
export const isShortAnswer = (answer: string) =>
  answer.includes('【这里的意思】') &&
  !answer.includes('【为什么】') &&
  !answer.includes('【整句翻译】');

// 第 1 个照旧是「词 | 句」，第 2 个起带上第几个（原来存的还能找到）
const vocabKey = (book: string, it: { text: string; sentence: string; nth?: number }) =>
  prefetchKey(book, `${occKey(it.text, it.nth)} | ${it.sentence}`);

/** 问一次，存下每个词的答案。已经有答案的、正在问的不再问。返回存了几个。 */
const prefetchVocabBatch = async (
  translator: CustomTranslator,
  book: string,
  items: VocabItem[],
  promptVersion: string,
): Promise<number> => {
  const todo: (VocabItem & { key: string })[] = [];
  for (const it of items) {
    const key = vocabKey(book, it);
    if (running.has(key) || todo.some((t) => t.key === key)) continue;
    if (await getRecord<PrefetchRecord>(PREFETCH, key)) continue;
    todo.push({ ...it, key });
  }
  if (!todo.length) return 0;
  todo.forEach((t) => running.add(t.key));
  try {
    await acquire();
    try {
      const [{ generateText }] = await loadSDK();
      const { text } = await generateText({
        model: await createChatModel(translator),
        system: getPrompts().vocabPrefetch,
        prompt: buildVocabPrompt(book, todo),
        temperature: translator.temperature ?? 0.2,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(90_000),
      });
      const rows = parseVocabRows(stripReasoning(text));
      let saved = 0;
      for (const [i, t] of todo.entries()) {
        const parts = rows.get(i + 1);
        // 编号对上、词也对上才存（AI 偶尔漏一行或换了顺序，这个词下次再问）
        if (!parts || n(parts[0]!) !== n(t.text)) continue;
        const rec: PrefetchRecord = {
          key: t.key,
          book,
          text: t.text,
          kind: 'word',
          sentence: t.sentence,
          para: t.para,
          answer: vocabRowToAnswer(parts),
          model: translator.model ?? '',
          promptVersion,
          createdAt: Date.now(),
          short: true,
          ...(t.nth > 1 ? { nth: t.nth } : {}),
        };
        await putRecord(PREFETCH, rec);
        saved++;
      }
      return saved;
    } finally {
      release();
    }
  } catch (e) {
    console.warn('[odybo] 生词预读失败', todo.map((t) => t.text).join(', '), e);
    return 0;
  } finally {
    todo.forEach((t) => running.delete(t.key));
  }
};

/** 预读进度：句子（截、整句）和生词分开数，卡片底部分开显示（开发者 10-23：两个开关分开后，进度也要分开） */
/**
 * 往后找生词（到本章末尾）：按顺序一句句看，找出生词本里的词，分成「已经有答案的」（预读过、或自己在这一句查过）
 * 和「还没答案的」（按出现顺序），凑够 want 个就停。一个词在不同的句子里各算一个（意思要看句子）。
 * 第一块只看选中处往后的句子（选中的那一句也算，选中的词本身不算）。
 */
const vocabAhead = async (
  book: string,
  blocks: AheadBlock[],
  entries: VocabEntry[],
  /** 刚查的那一处（词、所在句、第几个）：只跳过这一处，同一个词在别处照样算（10-24 前会把后面同样写法的全跳过） */
  skip: { word: string; sentence: string; nth: number },
  want: number,
): Promise<{ ready: number; missing: VocabItem[] }> => {
  const missing: VocabItem[] = [];
  let ready = 0;
  if (!entries.length || want <= 0) return { ready, missing };
  // 所有句子排成一串，前一句、后一句可以跨段
  const sents: { s: string; para: string; after: boolean }[] = [];
  for (const [bi, b] of blocks.entries()) {
    let cursor = 0;
    for (const s of splitSentences(b.text)) {
      const i = b.text.indexOf(s.slice(0, 30), cursor);
      const start = i >= 0 ? i : cursor;
      cursor = start + s.length;
      sents.push({ s, para: b.text, after: bi > 0 || cursor > b.from });
    }
  }
  const seen = new Set<string>();
  const skipS = n(skip.sentence);
  const isSkip = (surface: string, s: string, nth: number) =>
    n(surface) === skip.word &&
    nth === skip.nth &&
    !!skipS &&
    (n(s).includes(skipS) || skipS.includes(n(s)));
  for (const [i, x] of sents.entries()) {
    if (!x.after) continue;
    // 同一句里同一个词出现几次就各算一个（各有各的意思，10-24）
    for (const f of findVocabAll(x.s, entries)) {
      const k = `${n(f.surface)}#${f.nth}|${n(x.s)}`;
      if (seen.has(k) || isSkip(f.surface, x.s, f.nth)) continue;
      seen.add(k);
      const it = { text: f.surface, sentence: x.s, nth: f.nth };
      const has =
        (await getRecord<PrefetchRecord>(PREFETCH, vocabKey(book, it))) ||
        (await getRecord(HISTORY, historyKey(book, occKey(f.surface, f.nth), x.s)));
      if (has) ready++;
      else
        missing.push({
          ...it,
          para: x.para,
          prev: i > 0 ? sents[i - 1]!.s : '',
          next: i + 1 < sents.length ? sents[i + 1]!.s : '',
        });
      if (ready + missing.length >= want) return { ready, missing };
    }
  }
  return { ready, missing };
};

export interface PrefetchProgress {
  sentTotal: number;
  sentDone: number;
  wordTotal: number;
  wordDone: number;
  /** 往后这几句里，规则判简单、没预读的句数 */
  sentSkipped: number;
  /** 往后已经有答案的生词（这次没问的那些） */
  wordReady: number;
  /** 这次新问到、存下的（句子和生词合起来） */
  added: number;
}

/**
 * 从选中处往后预读：所在段落里选中内容结尾落在哪一截，就从那一截（没整个选中）或下一截（整个选中了）开始，
 * 往后「设置里的截数」截，不够就接着数下一段；其中长句的截，整句也加一份。
 * context：整段上下文（段与段之间空一行）；at：选中处在 context 里的位置。
 */
/** 只挑难句时，往后最多看几句 */
const LOOK_AHEAD = 12;

export const rollingPrefetch = async (opts: {
  translator: CustomTranslator;
  book: string;
  context: string;
  at: number;
  selection: string;
  /** 选中处所在的句子、是句里第几个：生词往后找时只跳过这一处 */
  selectedSentence?: string;
  selectedNth?: number;
  promptVersion: string;
  /** 选中处往后到本章末尾的各块（selection.ts 记的），生词往后找用 */
  ahead?: AheadBlock[];
  onProgress?: (p: PrefetchProgress) => void;
}) => {
  const { context, at, selection } = opts;
  // 两个开关分开管（开发者 10-23）：句子预读看「本书句子预读」（或所有书），生词预读看底栏「生词预读」，
  // 只开生词预读时也往后找生词，只是不问句子
  const st = getSettings();
  const doSentences = isAutoPrefetch(opts.book);
  const doVocab = st.vocabPrefetch && st.vocabPerRun > 0;
  if (!doSentences && !doVocab) return;
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
  const begin = covered ? last + 1 : last;
  let picked = seq.slice(begin, last + 1 + st.prefetchAhead);
  // 只挑难句（10-24）：往后最多看 LOOK_AHEAD 句，按整句打分，到分数线的句子才预读，凑够「预读截数」截为止
  let skipped = 0;
  if (st.sentenceMinScore > 0) {
    const sents: string[] = [];
    for (const u of seq.slice(begin)) if (sents.at(-1) !== u.sentence) sents.push(u.sentence);
    picked = [];
    for (const [k, s] of sents.slice(0, LOOK_AHEAD).entries()) {
      if (picked.length >= st.prefetchAhead) break;
      const d = sentenceDifficulty(s, sents[k + 1] ?? '');
      if (d.score < st.sentenceMinScore) {
        skipped++;
        continue;
      }
      for (const u of seq.slice(begin))
        if (u.sentence === s) picked.push({ ...u, score: d.score, reasons: d.reasons });
    }
  }
  // 长句的截：整句也预读一份（放在前面，截的答案会附上整句翻译）
  const units: Unit[] = [];
  const wholes = new Set<string>();
  for (const u of picked) {
    if (u.kind === 'chunk' && !wholes.has(u.sentence)) {
      wholes.add(u.sentence);
      units.push({
        para: u.para,
        sentence: u.sentence,
        text: u.sentence,
        kind: 'sent',
        score: u.score,
        reasons: u.reasons,
      });
    }
    units.push(u);
  }
  const skip = n(selection);
  // 生词预读（10-23 起）：从选中处往后找到本章末尾，保持往后有「往后备好几个」个生词有答案；
  // 只剩「剩几个就补」个或更少时，才把缺的一次补满（不管在哪一段，合成一次问），没到就不问
  let words: VocabItem[] = [];
  let ready = 0;
  if (doVocab) {
    const entries = await vocabForPrefetch(st.vocabMinCount, st.vocabDays);
    // 句子预读的请求里提醒 AI 一定解释这些生词（照小工具 vocab_hint）
    if (doSentences)
      for (const u of units) {
        const found = findVocab(u.text, entries);
        if (found.length) u.hint = [...new Set(found.map((f) => f.lemma))];
      }
    // 往后的段落：选中时记下的到本章末尾的各块；没有（PDF、退回 Readest 的前后文）就用上下文里选中处往后的那几段
    const blocks: AheadBlock[] = opts.ahead?.length
      ? opts.ahead
      : here.map((p, k) => ({ text: p.text, from: k === 0 ? Math.max(0, at - p.start) : 0 }));
    const r = await vocabAhead(
      opts.book,
      blocks,
      entries,
      { word: skip, sentence: opts.selectedSentence ?? '', nth: opts.selectedNth ?? 1 },
      st.vocabPerRun,
    );
    ready = r.ready;
    if (r.ready <= st.vocabRefillAt)
      words = r.missing.slice(0, Math.max(0, st.vocabPerRun - r.ready));
  }
  const todo = doSentences ? units.filter((u) => n(u.text) !== skip) : [];
  const progress: PrefetchProgress = {
    sentTotal: todo.length,
    sentDone: 0,
    sentSkipped: doSentences ? skipped : 0,
    wordTotal: words.length,
    wordDone: 0,
    wordReady: ready,
    added: 0,
  };
  opts.onProgress?.({ ...progress });
  await Promise.all([
    ...todo.map(async (u) => {
      const added = await prefetchUnit(opts.translator, opts.book, u, opts.promptVersion);
      progress.sentDone++;
      if (added) progress.added++;
      opts.onProgress?.({ ...progress });
    }),
    ...(words.length
      ? [
          (async () => {
            const added = await prefetchVocabBatch(
              opts.translator,
              opts.book,
              words,
              opts.promptVersion,
            );
            progress.wordDone += words.length;
            progress.added += added;
            opts.onProgress?.({ ...progress });
          })(),
        ]
      : []),
  ]);
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
  const outer = all.filter(
    (r) => r.kind !== 'word' && r.kind !== 'intro' && contains(n(r.text), ns),
  );
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

/** 一句里生词的每一处（同一个词出现两次就两条），按出现顺序；nth：同样写法在这一句里是第几个（10-24） */
const findVocabAll = (text: string, entries: VocabEntry[]) => {
  const out: { lemma: string; surface: string; at: number; nth: number }[] = [];
  const taken = new Set<number>();
  for (const e of entries) {
    for (const raw of [...e.forms, e.lemma]) {
      const cand = raw.replace(/[^A-Za-z '’-]+/g, ' ').trim();
      if (!cand) continue;
      const re = new RegExp(formRe(cand).source, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!m[0].length) {
          re.lastIndex++;
          continue;
        }
        if (taken.has(m.index)) continue;
        taken.add(m.index);
        const at = m.index;
        const nth = occurrences(text, m[0]).findIndex((o) => o.at === at) + 1 || 1;
        out.push({ lemma: e.lemma, surface: m[0], at, nth });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
};

/** 这段文字里出现了哪些生词：返回原形和在文字里的实际写法。查过的写法（forms）和原形都试。 */
export const findVocab = (text: string, entries: VocabEntry[]) => {
  const out: { lemma: string; surface: string }[] = [];
  for (const e of entries) {
    for (const raw of [...e.forms, e.lemma]) {
      // 查的时候可能连标点一起选中了（day—simple、up front,）：破折号、逗号这些换成空格，免得把两个词当成一个找
      const cand = raw.replace(/[^A-Za-z '’-]+/g, ' ').trim();
      if (!cand) continue;
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
export const findPrefetchedWord = async (book: string, word: string, sentence: string, nth = 1) => {
  const nw = n(word);
  const ns = n(sentence);
  if (!nw || !ns) return null;
  const all = await listByBook<PrefetchRecord>(PREFETCH, book);
  const r = all.find(
    (x) =>
      x.kind === 'word' &&
      n(x.text) === nw &&
      (x.nth ?? 1) === nth && // 同一句里第几个也要对上（10-24）
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
