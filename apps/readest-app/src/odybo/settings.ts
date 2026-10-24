// 我们自己的设置（存在本机 localStorage，不进 Readest 的设置、不同步）。
// 设置页界面在 SettingsPanel.tsx，挂在 Readest 设置窗口的「语境查词」标签下。
import { notifyChange } from './changes';

export interface OdyboSettings {
  /** 预读截数：从选中处往后预读几截（小工具的 prefetch_ahead_sents） */
  prefetchAhead: number;
  /** 短句长度：不超过这么多词的句子整句一截，超过的按逗号分成几截（小工具的 LONG_SENT） */
  shortSentenceWords: number;
  /** 难句分数线：只预读规则打分（sentenceDifficulty.ts）到这么多分的句子；0 = 不筛，照原来往后挨着预读（10-24） */
  sentenceMinScore: number;
  /** 所有书句子预读（不用每本书在卡片底下单独勾；只管句子，生词预读看 vocabPrefetch） */
  prefetchAllBooks: boolean;
  /** 查过几次才预读：生词本里查过这么多次（在不同的地方查）的词才预读（开发者 10-23 定，先定 2、看了数据改 1；
   * 原来是「生词范围」只看生词本前 20 个，排不进前 20 的词永远不预读，删了） */
  vocabMinCount: number;
  /** 最近几天：只看最近几天查过的生词 */
  vocabDays: number;
  /** 往后备好几个：从查词处往后（到本章末尾），保持这么多个生词已经有答案（10-23 起；原来叫「每次最多」）。0 = 不预读生词 */
  vocabPerRun: number;
  /** 剩几个就补（补货线）：往后有答案的生词只剩这么多个（或更少）时，一次补满到 vocabPerRun 个；
   * 没到就不问——免得每用掉一个就问一个，合并问没效果（开发者 10-23 定：剩 2 个就补，补满 5 个） */
  vocabRefillAt: number;
  /** 生词预读开关：关掉就不预读生词，书里也不标生词 */
  vocabPrefetch: boolean;
  /** 生词标法：gloss = 字上面显示这一句里的解释，dot = 只标一个带颜色的点 */
  vocabMarkStyle: 'gloss' | 'dot';
  /** 词组（蓝色标注）下面加一条蓝色虚线，标出词组从哪到哪（可能和 Readest 自己的标注下划线重叠，所以可以关） */
  phraseUnderline: boolean;
  /** 点（和解释小字）往下挪几像素：贴近单词，避开上一行词组的虚线（开发者 10-23，自己实测；0 = 原来的位置，负数往上） */
  markOffset: number;
  /** 句末的点：预读过的整句末尾（和长句里预读过的一截末尾）标一个点，点一下直接打开预读好的答案（开发者 10-23 想法，10-24 做） */
  sentenceDots: boolean;
  /** 单击查词：轻点正文里的英文单词就查它（点空白处照旧翻页、呼出菜单） */
  tapLookup: boolean;
  /** 同步到 WebDAV：查词记录、生词的移出和忽略、这些设置（dataSync.ts） */
  syncData: boolean;
  /** 同步时也带上预读结果（量大，可以关） */
  syncPrefetch: boolean;
}

export const DEFAULT_SETTINGS: OdyboSettings = {
  prefetchAhead: 3,
  shortSentenceWords: 20,
  sentenceMinScore: 4,
  prefetchAllBooks: false,
  vocabMinCount: 1,
  vocabDays: 30,
  vocabPerRun: 5,
  vocabRefillAt: 2,
  vocabPrefetch: true,
  vocabMarkStyle: 'gloss',
  phraseUnderline: true,
  markOffset: 0,
  sentenceDots: true,
  tapLookup: false,
  syncData: true,
  syncPrefetch: true,
};

/** 预读一次同时最多问几截（固定，不放进设置页；开发者 10-20 定） */
export const PREFETCH_PARALLEL = 3;

const KEY = 'odybo.settings';

export const getSettings = (): OdyboSettings => {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      prefetchAhead: Number(saved.prefetchAhead) || DEFAULT_SETTINGS.prefetchAhead,
      shortSentenceWords: Number(saved.shortSentenceWords) || DEFAULT_SETTINGS.shortSentenceWords,
      sentenceMinScore:
        Number(saved.sentenceMinScore) >= 0 && saved.sentenceMinScore !== undefined
          ? Number(saved.sentenceMinScore)
          : DEFAULT_SETTINGS.sentenceMinScore,
      prefetchAllBooks: saved.prefetchAllBooks === true,
      vocabMinCount:
        Number(saved.vocabMinCount) >= 1
          ? Number(saved.vocabMinCount)
          : DEFAULT_SETTINGS.vocabMinCount,
      vocabDays: Number(saved.vocabDays) || DEFAULT_SETTINGS.vocabDays,
      vocabPerRun:
        Number(saved.vocabPerRun) >= 0 && saved.vocabPerRun !== undefined
          ? Number(saved.vocabPerRun)
          : DEFAULT_SETTINGS.vocabPerRun,
      vocabRefillAt:
        Number(saved.vocabRefillAt) >= 0 && saved.vocabRefillAt !== undefined
          ? Number(saved.vocabRefillAt)
          : DEFAULT_SETTINGS.vocabRefillAt,
      vocabPrefetch: saved.vocabPrefetch !== false,
      vocabMarkStyle: saved.vocabMarkStyle === 'dot' ? 'dot' : 'gloss',
      phraseUnderline: saved.phraseUnderline !== false,
      markOffset: Number.isFinite(Number(saved.markOffset)) ? Number(saved.markOffset) : 0,
      sentenceDots: saved.sentenceDots !== false,
      tapLookup: saved.tapLookup === true,
      syncData: saved.syncData !== false,
      syncPrefetch: saved.syncPrefetch !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

const AT_KEY = 'odybo.settingsAt'; // 上次改设置的时间，多台设备同步时按时间新的为准

/** silentAt：从 WebDAV 拉下来的设置，记下它原来的时间、不再通知上传 */
export const saveSettings = (s: OdyboSettings, silentAt?: number) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem(AT_KEY, String(silentAt ?? Date.now()));
  } catch {
    // 存不了就只在这次打开时有效
  }
  if (silentAt === undefined) notifyChange({ kind: 'state' });
};

/** 同步用：设置和改的时间 */
export const exportSettings = () => {
  let at = 0;
  try {
    at = Number(localStorage.getItem(AT_KEY)) || 0;
  } catch {
    // 读不了当作没改过
  }
  return { value: getSettings(), at };
};
/** 同步用：别的设备的设置比本机新才用。返回用了没有。 */
export const importSettings = (remote?: { value?: Partial<OdyboSettings>; at?: number }) => {
  if (!remote?.value || !remote.at || remote.at <= exportSettings().at) return false;
  saveSettings({ ...getSettings(), ...remote.value }, remote.at);
  return true;
};
