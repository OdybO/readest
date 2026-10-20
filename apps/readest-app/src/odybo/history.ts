// 查过的答案、预读的答案都存在本机（浏览器 / App 的 IndexedDB），关掉 App 再打开还在。
// history：自己查的。怎样算「查过」：同一本书 + 同一个选中的内容 + 同一句（和电脑小工具的 hist_find_same 一样）。
//   同一个词在别的句子里会重新查：意思和整句翻译要按那一句来。
// prefetch：预读的一截或一句（照小工具的 prefetch_sent 表）。按「书 + 这一截的本质内容」存。

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
  source: 'lookup' | 'prefetch';
  createdAt: number;
}

export interface PrefetchRecord {
  /** 书 + 这一截（或这一句）的本质内容 */
  key: string;
  book: string;
  /** 这一截的原文 */
  text: string;
  /** 'chunk' = 长句里的一截，'sent' = 整句 */
  kind: 'chunk' | 'sent';
  /** 所在的整句（chunk 用它去找整句的翻译） */
  sentence: string;
  para: string;
  answer: string;
  model: string;
  promptVersion: string;
  createdAt: number;
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

export const putRecord = async (store: string, rec: { key: string }) => {
  try {
    await run(store, 'readwrite', (s) => s.put(rec));
  } catch (e) {
    console.warn('[odybo] 存本机记录失败', e);
  }
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

export const findHistory = (key: string) => getRecord<HistoryRecord>(HISTORY, key);
export const saveHistory = (rec: HistoryRecord) => putRecord(HISTORY, rec);

/** 提示词的短指纹（不追求安全，只用来区分版本）。 */
export const fingerprint = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
};
