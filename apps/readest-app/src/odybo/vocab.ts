// 生词本：照电脑小工具的 vocab_list，从「自己查过的」记录（history）里算出来，不另外存一份。
// 收什么：单词和短语（6 个词以内）；3 个词以上、句号结尾的整句不收。
// 合并：按 AI 回答里的【原形】（pursuing、pursued 都算 pursue），跨书合并。
// 排序：查询次数多的在前，次数一样按最近查询。
// 删除：记下删除时间，这个词那之前的记录都不算；以后再查一次，它会重新出现（误删也不怕）。
import { HISTORY, listAll, normalizeForKey, type HistoryRecord } from './history';

export interface VocabLookup {
  word: string;
  book: string;
  sentence: string;
  createdAt: number;
}

export interface VocabEntry {
  lemma: string;
  count: number;
  first: number;
  last: number;
  /** 查过的各种写法 */
  forms: string[];
  books: string[];
  /** 最近一次的意思（【这里的意思】那一行） */
  meaning: string;
  /** 每一次查询，最近的在前 */
  lookups: VocabLookup[];
}

/** 生词本只收单词和短语（六个词以内），长句只留在查询记录里（照 ctx_lookup.py 的 is_vocab）。 */
export const isVocab = (word: string) => {
  const w = (word || '').trim();
  const n = w.split(/\s+/).length;
  if (n >= 3 && /[.!?]["”’)]?$/.test(w)) return false;
  return !!w && n <= 6 && /[A-Za-z]/.test(w);
};

/** 词典原形：优先用 AI 写的【原形】，没有就用小写的原词（照 ctx_lookup.py 的 lemma_of）。 */
export const lemmaOf = (rec: { word: string; answer: string }) => {
  const m = rec.answer.match(/【原形】\s*([A-Za-z][A-Za-z '’\-.]*)/);
  if (m) return m[1]!.trim().toLowerCase();
  return rec.word
    .toLowerCase()
    .replace(/[^a-z '’-]/g, '')
    .trim();
};

const meaningOf = (answer: string) => {
  const m = answer.match(/【这里的意思】\s*(.*)/) ?? answer.match(/【翻译】\s*(.*)/);
  return (m?.[1] ?? '').trim();
};

// ---------- 删除记录（存在本机 localStorage：原形 → 删除时间） ----------

const DELETED_KEY = 'odybo.vocabDeleted';
const getDeleted = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(DELETED_KEY) || '{}');
  } catch {
    return {};
  }
};
export const deleteVocab = (lemma: string) => {
  const d = getDeleted();
  d[lemma] = Date.now();
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify(d));
  } catch {
    // 存不了就只在这次打开时有效
  }
};

export const loadVocab = async (): Promise<VocabEntry[]> => {
  const recs = await listAll<HistoryRecord>(HISTORY);
  const deleted = getDeleted();
  const groups = new Map<string, VocabEntry & { lastAnswer: string }>();
  recs.sort((a, b) => a.createdAt - b.createdAt);
  for (const r of recs) {
    if (!isVocab(r.word)) continue;
    const lemma = lemmaOf(r);
    if (!lemma || r.createdAt <= (deleted[lemma] ?? 0)) continue;
    let g = groups.get(lemma);
    if (!g) {
      g = {
        lemma,
        count: 0,
        first: r.createdAt,
        last: r.createdAt,
        forms: [],
        books: [],
        meaning: '',
        lookups: [],
        lastAnswer: '',
      };
      groups.set(lemma, g);
    }
    g.count++;
    g.last = r.createdAt;
    g.lastAnswer = r.answer;
    if (!g.forms.some((f) => normalizeForKey(f) === normalizeForKey(r.word))) g.forms.push(r.word);
    if (r.book && !g.books.includes(r.book)) g.books.push(r.book);
    g.lookups.unshift({ word: r.word, book: r.book, sentence: r.sentence, createdAt: r.createdAt });
  }
  const out = [...groups.values()].map(({ lastAnswer, ...g }) => ({
    ...g,
    meaning: meaningOf(lastAnswer),
  }));
  out.sort((a, b) => b.count - a.count || b.last - a.last);
  return out;
};

/** 分栏：按最近一次查询，一周内 / 一个月内 / 更早 */
export const VOCAB_TABS = [
  { id: 'week', label: '一周内', days: [0, 7] },
  { id: 'month', label: '一个月内', days: [7, 30] },
  { id: 'older', label: '更早', days: [30, Infinity] },
] as const;

export const inTab = (e: VocabEntry, tab: (typeof VOCAB_TABS)[number], now = Date.now()) => {
  const days = (now - e.last) / 86400000;
  return days >= tab.days[0] && days < tab.days[1];
};

/** 10-20 14:35 */
export const formatTime = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
