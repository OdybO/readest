// 单击查词：开着「单击查词」（底部工具栏「语境查词」里的开关）时，轻点正文里的一个英文单词就查它。
// 走单词透镜那条路（Annotator 替你选中再弹查词卡片），只是选区由这里给，算自己查的（进生词本）。
// 点空白处、页边，照旧翻页、呼出菜单；点链接、脚注、图片照旧（Readest 在这之前已经处理掉）。只查单个词，短语和句子还是长按拖选。
// 接入点：app/reader/utils/iframeEventHandlers.ts 的单击处理里，透镜判断后面调用 odyboTapWord(event)；
//         Annotator.tsx 的 handleWordLensDictionary 收下这里给的选区。
import { getSettings } from './settings';

const WORD_CHAR = /[A-Za-z0-9'’-]/;

/** 轻点处是不是一个英文单词：是就返回这个词和它的选区 */
export const odyboTapWord = (event: MouseEvent): { word: string; range: Range } | null => {
  if (!getSettings().tapLookup) return null;
  const target = event.target as Element | null;
  const doc = target?.ownerDocument;
  if (!doc || target?.closest('rt, rp, input, textarea, button')) return null;
  // 手指所在的文字位置（Chrome / 安卓 WebView 用 caretRangeFromPoint，Firefox 用 caretPositionFromPoint）
  let node: Node | null = null;
  let offset = 0;
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(event.clientX, event.clientY);
    node = p?.offsetNode ?? null;
    offset = p?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(event.clientX, event.clientY);
    node = r?.startContainer ?? null;
    offset = r?.startOffset ?? 0;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = (node as Text).data;
  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--;
  while (end < text.length && WORD_CHAR.test(text[end]!)) end++;
  // 去掉词两头的撇号、连字符（'tis 这种少见，不管）
  while (start < end && /['’-]/.test(text[start]!)) start++;
  while (end > start && /['’-]/.test(text[end - 1]!)) end--;
  const word = text.slice(start, end);
  if (!/[A-Za-z]/.test(word)) return null;
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  // 点在行尾空白处时也会给出最近的字：要真的点在这个词上（留 4 像素余量）
  const hit = [...range.getClientRects()].some(
    (b) =>
      event.clientX >= b.left - 4 &&
      event.clientX <= b.right + 4 &&
      event.clientY >= b.top - 4 &&
      event.clientY <= b.bottom + 4,
  );
  return hit ? { word, range } : null;
};
