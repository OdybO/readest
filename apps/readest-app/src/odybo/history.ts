// 查过的答案、预读的答案都存在本机（浏览器 / App 的 IndexedDB），关掉 App 再打开还在。
// history：自己查的。怎样算「查过」：同一本书 + 同一个选中的内容 + 同一句（和电脑小工具的 hist_find_same 一样）。
//   同一个词在别的句子里会重新查：意思和整句翻译要按那一句来。
// prefetch：预读的一截或一句（照小工具的 prefetch_sent 表）。按「书 + 这一截的本质内容」存。

import { notifyChange } from './changes';

const DB_NAME = 'odybo-ctx-lookup';
const VERSION = 2;
export const HISTORY = 'history';
export const PREFETCH = 'prefetch';

export interface HistoryRecord {
  /** 书 + 选中的内容 + 所在句，都做过归一化 */
  key: string;
  book: string;
  word: string;
  sentence: string;
  context: string;
  answer: string;
  model: string;
  /** 提示词的指纹：提示词改过以后，可以据此区分新旧答案 */
  promptVersion: string;
  /** lookup = 自己选中查的；prefetch = 用上了预读的答案；lens = 点单词透镜查的（只记来源；10-21 起也进生词本） */
  source: 'lookup' | 'prefetch' | 'lens';
  createdAt: number;
  /** 选中的是所在句里的第几个（同一句里同一个词出现不止一次时，10-24）；没有 = 第 1 个 */
  nth?: number;
}

export interface PrefetchRecord {
  /** 书 + 这一截（或这一句）的本质内容 */
  key: string;
  book: string;
  /** 这一截的原文 */
  text: string;
  /** 'chunk' = 长句里的一截，'sent' = 整句，'word' = 生词在这一句里，'intro' = 这本书的介绍（bookIntro.ts） */
  kind: 'chunk' | 'sent' | 'word' | 'intro';
  /** 所在的整句（chunk 用它去找整句的翻译） */
  sentence: string;
  para: string;
  answer: string;
  model: string;
  promptVersion: string;
  createdAt: number;
  /** 生词预读用短提示词问的（只有音标、这里的意思、原形、构词，10-23 起）；卡片上给「完整解释」按钮 */
  short?: boolean;
  /** 生词是所在句里的第几个（10-24）；没有 = 第 1 个 */
  nth?: number;
}

/** 比对用的「本质内容」：不分大小写、忽略标点和空格多少（照 ctx_lookup.py 的 _n）。 */
export const normalizeForKey = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'一-鿿]+/g, ' ')
    .replace(/(^|\s)'|'(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const historyKey = (book: string, word: string, sentence: string) =>
  [normalizeForKey(book), normalizeForKey(word), normalizeForKey(sentence)].join('|');

export const prefetchKey = (book: string, text: string) =>
  `${normalizeForKey(book)}|${normalizeForKey(text)}`;

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of [HISTORY, PREFETCH]) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'key' });
            store.createIndex('book', 'book');
            store.createIndex('createdAt', 'createdAt');
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null; // 打开失败（比如隐私模式）就下次再试，查词照常走 AI
    });
  }
  return dbPromise;
};

const run = async <T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const getRecord = async <T>(store: string, key: string): Promise<T | undefined> => {
  try {
    return await run<T | undefined>(store, 'readonly', (s) => s.get(key));
  } catch (e) {
    console.warn('[odybo] 读本机记录失败', e);
    return undefined;
  }
};

/** silent：从 WebDAV 拉下来写进本机时用，不通知同步再传上去 */
export const putRecord = async (
  store: string,
  rec: { key: string; createdAt?: number },
  silent = false,
) => {
  try {
    await run(store, 'readwrite', (s) => s.put(rec));
    if (!silent)
      notifyChange({ kind: store === HISTORY ? 'history' : 'prefetch', at: rec.createdAt });
  } catch (e) {
    console.warn('[odybo] 存本机记录失败', e);
  }
};

// ---------- 删掉一条记录（卡片上的「删除」，开发者 10-23：误点查出来的留着没用） ----------
// 删除要记下来（odybo.removedRecords：「库名|键」→ 删除时间），同步时告诉别的设备（dataSync.ts 的 state.json），
// 不然下次同步会从别的设备的文件里把它拉回来。删除之后再查同一处，新记录的时间比删除晚，照常存。
const REMOVED_KEY = 'odybo.removedRecords';
const readRemoved = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(REMOVED_KEY) || '{}');
  } catch {
    return {};
  }
};
const writeRemoved = (m: Record<string, number>) => {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(m));
  } catch {
    // 存不了就只在这次打开时有效
  }
};
/** 这条记录（时间 t）是不是在删除之前的：是的话同步时不要再拉回来 */
export const isRemoved = (store: string, key: string, t: number) =>
  t <= (readRemoved()[`${store}|${key}`] ?? 0);

/** 删掉一条记录；silent：别的设备删的（同步拉下来），不再通知上传 */
export const deleteRecord = async (store: string, key: string, at = Date.now(), silent = false) => {
  try {
    const rec = await getRecord<{ createdAt?: number }>(store, key);
    await run(store, 'readwrite', (s) => s.delete(key));
    writeRemoved({ ...readRemoved(), [`${store}|${key}`]: at });
    if (!silent) {
      // 这条所在的月份文件要重写（去掉它），state.json 要带上删除记号
      if (rec)
        notifyChange({ kind: store === HISTORY ? 'history' : 'prefetch', at: rec.createdAt });
      notifyChange({ kind: 'state' });
    }
  } catch (e) {
    console.warn('[odybo] 删本机记录失败', e);
  }
};

/** 同步用：全部删除记号 */
export const exportRemoved = () => readRemoved();
/** 同步用：别的设备删的，本机还留着且比删除早的，也删掉。返回删了几条。 */
export const importRemoved = async (remote: Record<string, number>) => {
  const mine = readRemoved();
  let n = 0;
  for (const [id, at] of Object.entries(remote ?? {})) {
    if (at <= (mine[id] ?? 0)) continue;
    const cut = id.indexOf('|');
    const store = id.slice(0, cut);
    const key = id.slice(cut + 1);
    const rec = await getRecord<{ createdAt: number }>(store, key);
    if (rec && rec.createdAt <= at) {
      // 不用 silent：本机自己的月份文件里还有这条，要重写一遍去掉它（state.json 带上删除记号也无妨，别的设备收到时间一样就跳过）
      await deleteRecord(store, key, at);
      n++;
    } else {
      writeRemoved({ ...readRemoved(), [id]: at });
    }
  }
  return n;
};

/** 这本书预读过的全部（找「选中的是某一截的一部分」时用）。 */
export const listByBook = async <T>(store: string, book: string): Promise<T[]> => {
  try {
    return await run<T[]>(store, 'readonly', (s) => s.index('book').getAll(book));
  } catch (e) {
    console.warn('[odybo] 读本机记录失败', e);
    return [];
  }
};

export const listAll = async <T>(store: string): Promise<T[]> => {
  try {
    return await run<T[]>(store, 'readonly', (s) => s.getAll());
  } catch (e) {
    console.warn('[odybo] 读本机记录失败', e);
    return [];
  }
};

export const countRecords = async (store: string): Promise<number> => {
  try {
    return await run<number>(store, 'readonly', (s) => s.count());
  } catch {
    return 0;
  }
};

export const findHistory = (key: string) => getRecord<HistoryRecord>(HISTORY, key);
export const saveHistory = (rec: HistoryRecord) => putRecord(HISTORY, rec);

/** 提示词的短指纹（不追求安全，只用来区分版本）。 */
export const fingerprint = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
};
