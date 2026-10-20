// 选中文字时，记下它所在的整段加前后各一段（PDF 按文字层的位置重建段落，EPUB 取所在的块），给查词用。
// 接入点：services/dictionaries/contextDictionary.ts 的 buildSelectionContext 开头调用 rememberSelection(range)。
// Readest 原来的前后文照常算、照常返回，这里只是另外记一份。
import { buildContextInfo } from './context-paragraph.js';
import { isOurMark } from './marks';

const MAX_CHARS = 2000;

interface Remembered {
  text: string;
  context: string;
  /** 这次是点单词透镜的小字查的（不进生词本） */
  fromLens: boolean;
  /** 选中处在 context 里的位置，-1 = 不知道 */
  at: number;
  /** 记下的时间 */
  time: number;
}

let last: Remembered | null = null;

// 单词透镜点小字时，Readest 先替你选中那个词再查；接入点：Annotator.tsx 在那条路上调用 markWordLensLookup()
// 点的是我们自己标的生词（marks.ts）就不算透镜：算自己查，进生词本
let lensPending = false;
export const markWordLensLookup = (element?: Element | null) => {
  lensPending = !isOurMark(element ?? null);
};

const norm = (s: string) =>
  s
    .replace(/[\s­]+/g, ' ')
    .trim()
    .toLowerCase();

export const rememberSelection = (range: Range) => {
  try {
    const text = range.toString();
    const info: { text: string; at: number } = buildContextInfo(range, { maxChars: MAX_CHARS });
    // 一次查词这里会被调两次：紧接着又记同一个词时，保留上一次的「点透镜查的」
    const again = !!last && last.text === norm(text) && Date.now() - last.time < 2000;
    const fromLens = lensPending || (again && last!.fromLens);
    last = info.text
      ? { text: norm(text), context: info.text, at: info.at, fromLens, time: Date.now() }
      : null;
    lensPending = false;
  } catch (e) {
    console.warn('[odybo] 整段上下文出错，退回 Readest 原来的前后文', e);
    last = null;
  }
};

/** 刚才选中这段文字时记下的整段上下文和选中处的位置；对不上（比如词典里点了别的词）就返回 null。 */
export const contextFor = (
  word: string,
): { context: string; at: number; fromLens: boolean } | null => {
  if (!last) return null;
  const w = norm(word);
  // PDF 选中的文字里可能有断行连字符（non-\ndigital），比较时去掉连字符和空白
  const squash = (s: string) => s.replace(/[-\s]/g, '');
  return last.text === w || squash(last.text) === squash(w)
    ? { context: last.context, at: last.at, fromLens: last.fromLens }
    : null;
};
