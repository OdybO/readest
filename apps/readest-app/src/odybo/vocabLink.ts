// 查词卡片上的「生词本」按钮：打开设置窗口，直接到「语境查词 → 生词本」。
// 不直接引用设置页和 Readest 的状态库：provider.ts 会被打进服务端的代码里，里面不能有 React 界面代码，用到时再加载。
let openVocabNext = false;

/** 设置页打开时问一下：是不是要直接显示生词本（问过就清掉） */
export const takeOpenVocab = () => {
  const v = openVocabNext;
  openVocabNext = false;
  return v;
};

export const openVocabBook = async () => {
  openVocabNext = true;
  const [{ useSettingsStore }, { useReaderStore }] = await Promise.all([
    import('@/store/settingsStore'),
    import('@/store/readerStore'),
  ]);
  const st = useSettingsStore.getState();
  st.setSettingsDialogBookKey(useReaderStore.getState().bookKeys[0] ?? '');
  st.setRequestedPanel('Odybo');
  st.setSettingsDialogOpen(true);
};
