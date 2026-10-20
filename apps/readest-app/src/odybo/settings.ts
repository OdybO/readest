// 我们自己的设置（存在本机 localStorage，不进 Readest 的设置、不同步）。
// 设置页界面在 SettingsPanel.tsx，挂在 Readest 设置窗口的「语境查词」标签下。

export interface OdyboSettings {
  /** 预读截数：从选中处往后预读几截（小工具的 prefetch_ahead_sents） */
  prefetchAhead: number;
  /** 短句长度：不超过这么多词的句子整句一截，超过的按逗号分成几截（小工具的 LONG_SENT） */
  shortSentenceWords: number;
  /** 所有书自动预读（不用每本书在卡片底下单独勾） */
  prefetchAllBooks: boolean;
}

export const DEFAULT_SETTINGS: OdyboSettings = {
  prefetchAhead: 3,
  shortSentenceWords: 20,
  prefetchAllBooks: false,
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
