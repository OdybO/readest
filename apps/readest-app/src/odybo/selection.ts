// 选中文字时，记下它所在的整段加前后各一段（PDF 按文字层的位置重建段落，EPUB 取所在的块），给查词用。
// 接入点：services/dictionaries/contextDictionary.ts 的 buildSelectionContext 开头调用 rememberSelection(range)。
// Readest 原来的前后文照常算、照常返回，这里只是另外记一份。
import { buildContextText } from './context-paragraph.js';

const MAX_CHARS = 2000;

let last: { text: string; context: string } | null = null;

const norm = (s: string) =>
  s
    .replace(/[\s­]+/g, ' ')
    .trim()
    .toLowerCase();

export const rememberSelection = (range: Range) => {
  try {
    const text = range.toString();
    const context: string = buildContextText(range, { maxChars: MAX_CHARS }) || '';
    last = context ? { text: norm(text), context } : null;
  } catch (e) {
    console.warn('[odybo] 整段上下文出错，退回 Readest 原来的前后文', e);
    last = null;
  }
};

/** 刚才选中这段文字时记下的整段上下文；对不上（比如词典里点了别的词）就返回空。 */
export const contextFor = (word: string): string => {
  if (!last) return '';
  const w = norm(word);
  // PDF 选中的文字里可能有断行连字符（non-\ndigital），比较时去掉连字符和空白
  const squash = (s: string) => s.replace(/[-\s]/g, '');
  return last.text === w || squash(last.text) === squash(w) ? last.context : '';
};
