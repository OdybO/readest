// 单击查词：开着「单击查词」（底部工具栏「语境查词」里的开关）时，轻点正文里的一个英文单词就查它。
// 走单词透镜那条路（Annotator 替你选中再弹查词卡片），只是选区由这里给，算自己查的（进生词本）。
// 点空白处、页边，照旧翻页、呼出菜单；点链接、脚注、图片照旧（Readest 在这之前已经处理掉）。只查单个词，短语和句子还是长按拖选。
// 接入点：app/reader/utils/iframeEventHandlers.ts 的单击处理里，透镜判断后面调用 odyboTapWord(event)；
//         Annotator.tsx 的 handleWordLensDictionary 收下这里给的选区。
import { getSettings } from './settings';
import { HISTORY, listAll, type HistoryRecord } from './history';
import { onChange } from './changes';
import { isIgnored, lemmaOf } from './vocab';
import { parseWordList } from './commonWords';
import { getPrompts } from './remotePrompts';

// ---------- 单击时跳过哪些词（开发者 10-23） ----------
// 跳过：生词本里忽略过的词；常用词表（commonWords.ts，WebDAV 上 common_words.txt 可改）里的词。
// 但自己查过的词（长按查过一次）下次单击照常查。跳过 = 当成点空白处（照旧翻页、呼出菜单）；长按选中照样能查。
let looked: Set<string> | null = null; // 自己查过的单词和它们的原形（小写）
let loading = false;
const loadLooked = () => {
  if (loading) return;
  loading = true;
  void listAll<HistoryRecord>(HISTORY)
    .then((recs) => {
      const s = new Set<string>();
      for (const r of recs) {
        const w = r.word.trim().toLowerCase();
        if (/^[a-z'’-]+$/.test(w)) s.add(w.replace(/’/g, "'"));
        s.add(lemmaOf(r).toLowerCase());
      }
      looked = s;
    })
    .finally(() => {
      loading = false;
    });
};
onChange((c) => {
  if (c.kind === 'history') loadLooked(); // 查了新词、删了记录、同步拉下来：重新读一遍
});

let commonText = '';
let common = new Set<string>();
const commonWords = () => {
  const text = getPrompts().commonWords;
  if (text !== commonText) {
    commonText = text;
    common = parseWordList(text);
  }
  return common;
};

/** 去掉常见词尾，猜几个原形（players → player，played → play），用来对忽略的词 */
const stems = (w: string) => {
  const out = new Set([w]);
  for (const [suf, add] of [
    ['ies', 'y'],
    ['es', ''],
    ['s', ''],
    ['ed', ''],
    ['ed', 'e'],
    ['ing', ''],
    ['ing', 'e'],
  ] as const)
    if (w.endsWith(suf) && w.length > suf.length + 2) out.add(w.slice(0, -suf.length) + add);
  return out;
};

const skipTap = (word: string) => {
  const w = word.toLowerCase().replace(/’/g, "'");
  for (const s of stems(w)) if (isIgnored(s)) return true; // 忽略过的：查过也跳过
  if (!looked) loadLooked();
  if (looked?.has(w)) return false; // 常用词里自己查过的照常查
  return commonWords().has(w);
};

const WORD_CHAR = /[A-Za-z0-9'’-]/;

// 点在 Readest 自己的高亮、下划线（自己做的笔记）上：单击查词让开，交给 Readest 选中整条、弹出高亮菜单（开发者 10-23）。
// 高亮是 foliate 在每一章上面画的一层（overlayer），用它的 hitTest 看点没点中；搜索结果的高亮不算。
// 状态库用到时再加载（见 vocabLink.ts 的说明），加载好之前当作没点中。
type Overlayer = { hitTest: (e: MouseEvent) => [string?, ...unknown[]] };
let getViewOf: ((key: string) => unknown) | null = null;
void import('@/store/readerStore').then((m) => {
  getViewOf = (key) => m.useReaderStore.getState().getView(key);
});
const onReadestHighlight = (event: MouseEvent, doc: Document, bookKey?: string) => {
  if (!bookKey || !getViewOf) return false;
  try {
    const view = getViewOf(bookKey) as {
      renderer?: { getContents?: () => { doc: Document; overlayer?: Overlayer }[] };
    } | null;
    const content = view?.renderer?.getContents?.().find((c) => c.doc === doc);
    const [value] = content?.overlayer?.hitTest(event) ?? [];
    return !!value && !value.startsWith('foliate-search:');
  } catch {
    return false;
  }
};

/** 轻点处是不是一个英文单词：是就返回这个词和它的选区 */
export const odyboTapWord = (
  event: MouseEvent,
  bookKey?: string,
): { word: string; range: Range } | null => {
  if (!getSettings().tapLookup) return null;
  const target = event.target as Element | null;
  const doc = target?.ownerDocument;
  if (!doc || target?.closest('rt, rp, input, textarea, button')) return null;
  if (onReadestHighlight(event, doc, bookKey)) return null;
  // 查词卡片开着、或者选着文字（选字工具条开着）：这一下是要关掉它们，照 Readest 原来的处理，不查词（开发者 10-21）
  if (document.querySelector('[data-dict-content]')) return null;
  const sel = doc.getSelection();
  if (sel && !sel.isCollapsed) return null;
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
  if (skipTap(word)) return null; // 忽略过的、常用词（自己没查过的）：当成点空白处
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
