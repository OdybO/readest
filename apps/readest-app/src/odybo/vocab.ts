// 生词本：照电脑小工具的 vocab_list，从「自己查过的」记录（history）里算出来，不另外存一份。
// 收什么：单词和短语（6 个词以内）；3 个词以上、句号结尾的整句不收。
// 合并：按 AI 回答里的【原形】（pursuing、pursued 都算 pursue），跨书合并。
// 排序：查询次数多的在前，次数一样按最近查询。
// 删除（移出生词本）：记下删除时间，这个词那之前的记录都不算；以后再查一次，它会重新出现（误删也不怕）。
// 忽略：这个词以后再查也不进生词本，在生词本「已忽略」栏里可以恢复。
import { HISTORY, listAll, normalizeForKey, type HistoryRecord } from './history';
import { notifyChange } from './changes';

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

/** 算不算生词（进生词本、书里标出来）：AI 的回答里【原形】写了英文才算（10-23 开发者定，不再数个数）。
 * 提示词让 AI 判断：单个词、固定搭配（不管几个词、包括中间插词的）写原形；两三个普通的词组合原形写「无」；
 * 半截句子、整句用长句格式，没有【原形】。原来「六个词以内」会把半截句子收进生词本。
 * 回答里没有【原形】这一栏的老记录（查词格式），还按原来的个数规则算（照 ctx_lookup.py 的 is_vocab_rec）。 */
export const isVocab = (answer: string, word = '') => {
  const a = answer || '';
  if (a.includes('【原形】')) return /【原形】\s*[A-Za-z]/.test(a);
  const w = word.trim();
  const n = w.split(/\s+/).length;
  if (!a.includes('【这里的意思】') || (n >= 3 && /[.!?]["”’)]?$/.test(w))) return false;
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

// ---------- 移出生词本、忽略（存在本机 localStorage） ----------
// 移出：原形 → 移出时间，这个词那之前的记录都不算。忽略：原形 → 忽略时间，以后再查也不进生词本。
// 放回、取消忽略时记下「取消的时间」（odybo.vocabCleared），多台设备同步时按时间新的为准（dataSync.ts）。

const DELETED_KEY = 'odybo.vocabDeleted';
const IGNORED_KEY = 'odybo.vocabIgnored';
const CLEARED_KEY = 'odybo.vocabCleared';
type FlagKind = 'deleted' | 'ignored';
const FLAG_KEY: Record<FlagKind, string> = { deleted: DELETED_KEY, ignored: IGNORED_KEY };

const readMap = (key: string): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
};
const writeMap = (key: string, d: object) => {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    // 存不了就只在这次打开时有效
  }
};
const readCleared = () =>
  readMap(CLEARED_KEY) as unknown as Record<FlagKind, Record<string, number>> & object;

/** 设上（on）或取消某个词的「移出 / 忽略」，t 是时间；silent = 从 WebDAV 拉下来的，不再通知上传 */
const setFlag = (kind: FlagKind, lemma: string, on: boolean, t = Date.now(), silent = false) => {
  const map = readMap(FLAG_KEY[kind]);
  const cleared = readCleared();
  const c = { ...(cleared[kind] ?? {}) };
  if (on) {
    map[lemma] = t;
    delete c[lemma];
  } else {
    delete map[lemma];
    c[lemma] = t;
  }
  writeMap(FLAG_KEY[kind], map);
  writeMap(CLEARED_KEY, { ...cleared, [kind]: c });
  if (!silent) notifyChange({ kind: 'state' });
};

const getDeleted = () => readMap(DELETED_KEY);
export const getIgnored = () => readMap(IGNORED_KEY);
export const deleteVocab = (lemma: string) => setFlag('deleted', lemma, true);
export const undeleteVocab = (lemma: string) => setFlag('deleted', lemma, false);
export const isIgnored = (lemma: string) => lemma in getIgnored();
/** 这条记录（时间 t）是不是在移出生词本之前的（移出之后再查的不算） */
export const isDeletedBefore = (lemma: string, t: number) => t <= (getDeleted()[lemma] ?? 0);
export const ignoreVocab = (lemma: string) => setFlag('ignored', lemma, true);
export const unignoreVocab = (lemma: string) => setFlag('ignored', lemma, false);

/** 同步用：原形 → 时间，正数 = 设上（移出 / 忽略）的时间，负数 = 取消的时间 */
export type FlagExport = Record<FlagKind, Record<string, number>>;
export const exportFlags = (): FlagExport => {
  const cleared = readCleared();
  const out = { deleted: {}, ignored: {} } as FlagExport;
  for (const kind of ['deleted', 'ignored'] as FlagKind[]) {
    for (const [l, t] of Object.entries(readMap(FLAG_KEY[kind]))) out[kind][l] = t;
    for (const [l, t] of Object.entries(cleared[kind] ?? {}))
      if (!(l in out[kind]) || t > out[kind][l]!) out[kind][l] = -t;
  }
  return out;
};
/** 同步用：别的设备的移出 / 忽略，比本机新的才用。返回改了几个。 */
export const importFlags = (remote: Partial<FlagExport>) => {
  const mine = exportFlags();
  let n = 0;
  for (const kind of ['deleted', 'ignored'] as FlagKind[]) {
    for (const [l, v] of Object.entries(remote[kind] ?? {})) {
      const cur = mine[kind][l];
      if (cur === undefined || Math.abs(v) > Math.abs(cur)) {
        setFlag(kind, l, v > 0, Math.abs(v), true);
        n++;
      }
    }
  }
  return n;
};

export const loadVocab = async (): Promise<VocabEntry[]> => {
  const recs = await listAll<HistoryRecord>(HISTORY);
  const deleted = getDeleted();
  const ignored = getIgnored();
  const groups = new Map<string, VocabEntry & { lastAnswer: string }>();
  recs.sort((a, b) => a.createdAt - b.createdAt);
  for (const r of recs) {
    if (!isVocab(r.answer, r.word)) continue; // 点单词透镜查的也算（10-21 开发者定：点了就是不认识）
    const lemma = lemmaOf(r);
    if (!lemma || lemma in ignored || r.createdAt <= (deleted[lemma] ?? 0)) continue;
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

/** 生词预读用：查过至少 minCount 次、最近 days 天查过的（不再只取前几个，开发者 10-23）。
 * 次数 = 生词本里的次数：同一处再查一次不加（记录按「书 + 词 + 这一句」存），在别的地方查才加。 */
export const vocabForPrefetch = async (minCount: number, days: number) => {
  const since = Date.now() - days * 86400000;
  return (await loadVocab()).filter((e) => e.last >= since && e.count >= minCount);
};
