// 我们自己的设置（存在本机 localStorage，不进 Readest 的设置、不同步）。
// 设置页界面在 SettingsPanel.tsx，挂在 Readest 设置窗口的「语境查词」标签下。

export interface OdyboSettings {
  /** 预读截数：从选中处往后预读几截（小工具的 prefetch_ahead_sents） */
  prefetchAhead: number;
  /** 短句长度：不超过这么多词的句子整句一截，超过的按逗号分成几截（小工具的 LONG_SENT） */
  shortSentenceWords: number;
  /** 所有书自动预读（不用每本书在卡片底下单独勾） */
  prefetchAllBooks: boolean;
  /** 生词范围：只看生词本排在最前的几个 */
  vocabTop: number;
  /** 最近几天：只看最近几天查过的生词 */
  vocabDays: number;
  /** 每次最多：每次预读最多多查几个生词 */
  vocabPerRun: number;
  /** 生词预读开关：关掉就不预读生词，书里也不标生词 */
  vocabPrefetch: boolean;
  /** 生词标法：gloss = 字上面显示这一句里的解释，dot = 只标一个带颜色的点 */
  vocabMarkStyle: 'gloss' | 'dot';
  /** 单击查词：轻点正文里的英文单词就查它（点空白处照旧翻页、呼出菜单） */
  tapLookup: boolean;
}

export const DEFAULT_SETTINGS: OdyboSettings = {
  prefetchAhead: 3,
  shortSentenceWords: 20,
  prefetchAllBooks: false,
  vocabTop: 20,
  vocabDays: 30,
  vocabPerRun: 5,
  vocabPrefetch: true,
  vocabMarkStyle: 'gloss',
  tapLookup: false,
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
      prefetchAllBooks: saved.prefetchAllBooks === true,
      vocabTop: Number(saved.vocabTop) || DEFAULT_SETTINGS.vocabTop,
      vocabDays: Number(saved.vocabDays) || DEFAULT_SETTINGS.vocabDays,
      vocabPerRun:
        Number(saved.vocabPerRun) >= 0 && saved.vocabPerRun !== undefined
          ? Number(saved.vocabPerRun)
          : DEFAULT_SETTINGS.vocabPerRun,
      vocabPrefetch: saved.vocabPrefetch !== false,
      vocabMarkStyle: saved.vocabMarkStyle === 'dot' ? 'dot' : 'gloss',
      tapLookup: saved.tapLookup === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (s: OdyboSettings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 存不了就只在这次打开时有效
  }
};
