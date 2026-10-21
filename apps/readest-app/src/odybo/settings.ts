// 我们自己的设置（存在本机 localStorage，不进 Readest 的设置、不同步）。
// 设置页界面在 SettingsPanel.tsx，挂在 Readest 设置窗口的「语境查词」标签下。
import { notifyChange } from './changes';

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
  /** 同步到 WebDAV：查词记录、生词的移出和忽略、这些设置（dataSync.ts） */
  syncData: boolean;
  /** 同步时也带上预读结果（量大，可以关） */
  syncPrefetch: boolean;
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
