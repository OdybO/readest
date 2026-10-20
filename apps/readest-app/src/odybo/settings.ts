// 我们自己的设置（存在本机 localStorage，不进 Readest 的设置、不同步）。
// 设置页界面在 SettingsPanel.tsx，挂在 Readest 设置窗口的「语境查词」标签下。

export interface OdyboSettings {
  /** 预读往后几截（小工具的 prefetch_ahead_sents） */
  prefetchAhead: number;
  /** 预读同时最多几个请求 */
  prefetchParallel: number;
  /** 所有书都自动预读（不用每本书在卡片底下单独勾） */
  prefetchAllBooks: boolean;
}

export const DEFAULT_SETTINGS: OdyboSettings = {
  prefetchAhead: 3,
  prefetchParallel: 3,
  prefetchAllBooks: false,
};

const KEY = 'odybo.settings';

export const getSettings = (): OdyboSettings => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
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
