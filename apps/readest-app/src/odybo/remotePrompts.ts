// 提示词放在 WebDAV 上，改了不用重新编译（开发者 10-21）。
// 位置：Readest 设置里 WebDAV 的「根目录」下 odybo/prompts/（N1 上是 X:\Private\ReadestSync\odybo\prompts\，电脑小工具读同一份）：
//   system.txt      主提示词（发给 AI 的 system）
//   chunk.txt       选中长句里的一截时附在后面的要求
//   vocab_hint.txt  预读时的生词提醒，{words} 换成这里出现的生词
//   vocab_prefetch.txt 生词预读的短提示词（一次问几个生词，一个词一行，prefetch.ts）
//   book_intro.txt  「书的介绍」的提示词（bookIntro.ts）
//   common_words.txt 单击查词时跳过的常用词，一行一个（commonWords.ts）
// 读到的存在本机 localStorage（odybo.prompts），连不上时用上次读到的；一次都没读到、或某个文件没有，就用 App 自带的（prompt.ts）。
// 用 Readest 自己的 WebDAV 地址、账号和读文件函数（services/sync/providers/webdav/client.ts），不另外设置。
// 状态库和 WebDAV 函数用到时再加载：这个文件会被 provider.ts 引用，见 vocabLink.ts 的说明。
import { COMMON_WORDS_TEXT } from './commonWords';
import {
  BOOK_INTRO_PROMPT,
  CHUNK_RULE,
  ODYBO_SYSTEM_PROMPT,
  VOCAB_HINT,
  VOCAB_PREFETCH_PROMPT,
} from './prompt';

export interface Prompts {
  system: string;
  chunk: string;
  vocabHint: string;
  vocabPrefetch: string;
  bookIntro: string;
  commonWords: string;
  /** webdav = 至少一个文件是从 WebDAV 读的 */
  source: 'builtin' | 'webdav';
  /** 上次从 WebDAV 读到的时间 */
  fetchedAt?: number;
}

const KEY = 'odybo.prompts';
const FILES = {
  system: 'system.txt',
  chunk: 'chunk.txt',
  vocabHint: 'vocab_hint.txt',
  vocabPrefetch: 'vocab_prefetch.txt',
  bookIntro: 'book_intro.txt',
  commonWords: 'common_words.txt',
} as const;
const REFRESH_MS = 10 * 60_000; // 最多 10 分钟读一次

const BUILTIN: Prompts = {
  system: ODYBO_SYSTEM_PROMPT,
  chunk: CHUNK_RULE,
  vocabHint: VOCAB_HINT,
  vocabPrefetch: VOCAB_PREFETCH_PROMPT,
  bookIntro: BOOK_INTRO_PROMPT,
  commonWords: COMMON_WORDS_TEXT,
  source: 'builtin',
};

let mem: Prompts | null = null;

/** 现在用哪一份提示词（马上返回，不等网络） */
export const getPrompts = (): Prompts => {
  if (mem) return mem;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Prompts | null;
    if (saved?.system) return (mem = { ...BUILTIN, ...saved });
  } catch {
    // 读不了就用自带的
  }
  return BUILTIN;
};

/** WebDAV 上提示词文件夹的路径（给设置页显示用） */
export const promptDir = (rootPath: string) =>
  `${(rootPath || '/').replace(/\/+$/, '')}/odybo/prompts`;

let lastTry = 0;

/** 从 WebDAV 重新读一遍。返回一句说明（设置页显示）；没到时间、没设 WebDAV 就什么都不做。 */
export const refreshPrompts = async (force = false): Promise<string> => {
  if (!force && Date.now() - lastTry < REFRESH_MS) return '';
  lastTry = Date.now();
  try {
    const [{ useSettingsStore }, { getFile }] = await Promise.all([
      import('@/store/settingsStore'),
      import('@/services/sync/providers/webdav/client'),
    ]);
    const w = useSettingsStore.getState().settings?.webdav;
    if (!w?.serverUrl) {
      // 没设（或去掉了）WebDAV：换回 App 自带的，不再用以前记下的
      mem = BUILTIN;
      try {
        localStorage.removeItem(KEY);
      } catch {
        // 删不了也没关系，这次打开已经换回来了
      }
      return 'Readest 里还没设置 WebDAV，用的是 App 自带的提示词';
    }
    const config = { serverUrl: w.serverUrl, username: w.username, password: w.password };
    const dir = promptDir(w.rootPath);
    const keys = Object.keys(FILES) as (keyof typeof FILES)[];
    const got = await Promise.all(keys.map((k) => getFile(config, `${dir}/${FILES[k]}`)));
    const next: Prompts = { ...BUILTIN, source: 'builtin' };
    const found: string[] = [];
    keys.forEach((k, i) => {
      const text = got[i]?.replace(/^\uFEFF/, '').trim(); // 记事本存的 UTF-8 可能带 BOM
      if (text) {
        next[k] = text;
        found.push(FILES[k]);
      }
    });
    if (!found.length) return `WebDAV 上 ${dir} 里没有提示词文件，用的是 App 自带的`;
    next.source = 'webdav';
    next.fetchedAt = Date.now();
    mem = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // 存不了就只在这次打开时有效
    }
    return `从 WebDAV 读到：${found.join('、')}`;
  } catch (e) {
    return `读 WebDAV 失败，用上次读到的：${e instanceof Error ? e.message : String(e)}`;
  }
};
