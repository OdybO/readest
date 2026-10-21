// 在书里标出预读过的生词：照单词透镜的做法，把词包成 <ruby class="wl-gloss odybo-vocab">词<rt>标注</rt></ruby>。
// 标注是这一句里的解释（「生词标法」= 解释），或一个带颜色的点（= 点）。
// 用透镜的 class（wl-gloss），点一下就走透镜那条路：Readest 替你选中这个词再查，出来的是我们的语境查词。
// 标两种：「生词预读」预读过的（同一本书、同一个词、同一句），和自己查过的单词、短语（点透镜小字查的也算，换掉透镜的小字）。
// 都是按那一句存的，所以解释一定是这一句里的意思。忽略了的词不标，移出生词本的词在移出之前的记录不标。
// 只用于 EPUB 这类能重排的书（和透镜一样，PDF 不做）。
// 接入点：FoliateViewer.tsx 每次透镜刷新完一章后调用 markVocabInDoc(doc, book)。
import { HISTORY, PREFETCH, listByBook, type HistoryRecord, type PrefetchRecord } from './history';
import { getSettings } from './settings';
import { isDeletedBefore, isIgnored, isVocab, lemmaOf } from './vocab';

const OUR_CLASS = 'odybo-vocab';
const LENS_CLASS = 'wl-gloss';

/** 打开着的章节文档 → 属于哪本书（预读完、改设置时重标用）。挂在 window 上，各处拿到的是同一份 */
const g = (typeof window !== 'undefined' ? window : {}) as unknown as Record<string, unknown>;
const docs = (g['__odyboDocs'] ??= new Map<Document, string>()) as Map<Document, string>;

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 字上面的解释要短（和透镜一样只是个提示）：取【这里的意思】第一个分句，最多 8 个字 */
const meaningOf = (answer: string) => {
  const m = answer.match(/【这里的意思】\s*(.*)/) ?? answer.match(/【翻译】\s*(.*)/);
  const first = (m?.[1] ?? '')
    .trim()
    .split(/[，；,;（(]/)[0]!
    .trim();
  // 「、」隔开的是几个近义说法，第一个不一定对（bores：「令人讨厌、厌烦的人」只取前一个就错了）：
  // 10 个字以内整个留下；更长就在 10 个字以内最后一个「、」处截；没有「、」就截 8 个字加省略号（10-21 用真 AI 的回答核对过）
  if (first.length <= 10) return first;
  const cut = first.lastIndexOf('、', 10);
  return cut > 0 ? first.slice(0, cut) : `${first.slice(0, 8)}…`;
};

/** 拆掉我们的一个标注（原来是透镜的，还原成透镜的样子） */
const unwrapOne = (ruby: Element) => {
  const lensGloss = ruby.getAttribute('data-odybo-lens');
  if (lensGloss !== null) {
    ruby.classList.remove(OUR_CLASS);
    ruby.removeAttribute('data-odybo-lens');
    const rt = ruby.querySelector('rt');
    if (rt) {
      rt.textContent = lensGloss;
      rt.removeAttribute('style');
    }
    return;
  }
  ruby.querySelectorAll('rt').forEach((rt) => rt.remove());
  const parent = ruby.parentNode;
  if (!parent) return;
  while (ruby.firstChild) parent.insertBefore(ruby.firstChild, ruby);
  parent.removeChild(ruby);
  parent.normalize(); // 只合并这一处拆开的文字
};

/** 去掉我们的全部标注（关掉「生词预读」时） */
const clearOurs = (doc: Document) => {
  doc.querySelectorAll(`ruby.${OUR_CLASS}`).forEach(unwrapOne);
};

/** 标注里的词本身（不算 rt 小字）：第一个文字节点和总长度 */
const baseOf = (ruby: Element) => {
  let first: Text | null = null;
  let len = 0;
  const w = ruby.ownerDocument.createTreeWalker(ruby, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n as Text).parentElement?.closest('rt, rp')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    first ??= n as Text;
    len += (n as Text).data.length;
  }
  return { first, len };
};

/** 章节里所有正文文字拼起来（透镜包过的词也算，标注小字 rt 不算），记下每一段在哪个文字节点 */
const textModel = (doc: Document) => {
  const root = doc.body ?? doc.documentElement;
  const segs: { node: Text; start: number }[] = [];
  let text = '';
  if (!root)
    return {
      text,
      locate: (_offset: number, _atEnd?: boolean) => null as { node: Text; offset: number } | null,
      offsetOf: (_node: Text | null) => -1,
    };
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n as Text).parentElement?.closest('rt, rp, script, style')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data) continue;
    segs.push({ node: t, start: text.length });
    text += t.data;
  }
  // atEnd：找的是词尾，正好落在两个文字块交界处时算前一块（透镜包好的词，词尾就是它那块的末尾）
  const locate = (offset: number, atEnd = false) => {
    let found: { node: Text; start: number } | null = null;
    for (const s of segs) {
      if (atEnd ? s.start < offset : s.start <= offset) found = s;
      else break;
    }
    return found ? { node: found.node, offset: offset - found.start } : null;
  };
  // 某个文字节点在整章文字里从第几个字开始（找已有的标注在哪）
  const starts = new Map(segs.map((s) => [s.node, s.start]));
  const offsetOf = (node: Text | null) => (node ? (starts.get(node) ?? -1) : -1);
  return { text, locate, offsetOf };
};

const styleRt = (rt: HTMLElement, gloss: boolean) => {
  Object.assign(rt.style, {
    color: '#e8649a',
    fontSize: gloss ? '0.55em' : '0.6em',
    fontWeight: gloss ? 'normal' : 'bold',
  });
};

/** 标出这一章里预读过的生词。 */
// 查词卡片开着、或者正选着文字时不动书里的标注：包词会改动选中的那段文字，Readest 当成选区没了，就把卡片关了
// （开发者 10-21 遇到「卡片自己关掉」，网页上重现：查完新词、给它包标注的那一刻卡片关闭）。等卡片关了再标。
const busy = () =>
  !!document.querySelector('[data-dict-content]') ||
  [...docs.keys()].some((d) => {
    const sel = d.defaultView ? d.getSelection() : null;
    return !!sel && !sel.isCollapsed;
  });
const waiting = new Map<Document, string>();
let waitTimer: ReturnType<typeof setInterval> | null = null;
const markLater = (doc: Document, book: string) => {
  waiting.set(doc, book);
  if (waitTimer) return;
  waitTimer = setInterval(() => {
    if (busy()) return;
    if (waitTimer) clearInterval(waitTimer);
    waitTimer = null;
    const list = [...waiting];
    waiting.clear();
    for (const [d, b] of list) if (d.defaultView) void markVocabInDoc(d, b);
  }, 800);
};

export const markVocabInDoc = async (doc: Document, book: string) => {
  docs.set(doc, book);
  void import('./dataSync').then((m) => m.syncSoon()); // 打开书时顺便和 WebDAV 同步（最多 10 分钟一次）
  if (busy()) return markLater(doc, book);
  try {
    const st = getSettings();
    if (!st.vocabPrefetch) return clearOurs(doc); // 生词预读关着：不标
    const pre = (await listByBook<PrefetchRecord>(PREFETCH, book)).filter((r) => r.kind === 'word');
    const own = (await listByBook<HistoryRecord>(HISTORY, book))
      .filter((r) => r.sentence && isVocab(r.word))
      .map((r) => ({ text: r.word, sentence: r.sentence, answer: r.answer, at: r.createdAt }));
    // 忽略了的不标；移出生词本的，移出之前的记录不标（再查一次又会标）
    const recs = [...own, ...pre.map((r) => ({ ...r, at: r.createdAt }))].filter((r) => {
      const lemma = lemmaOf({ word: r.text, answer: r.answer });
      return !isIgnored(lemma) && !isDeletedBefore(lemma, r.at);
    });
    if (!doc.defaultView) return;
    if (busy()) return markLater(doc, book); // 读记录的这段时间里打开了查词卡片
    // 只改要变的（开发者 10-21：整章拆掉重标时文字会跳一下）：算出这一章应该有哪些标注，
    // 和已有的比——一样的不动，只是字不同的原地改字，不该有的拆掉，新的才包上
    let model = textModel(doc);
    const lower = model.text.toLowerCase();
    const targets: { start: number; end: number; rec: { answer: string } }[] = [];
    const taken = new Set<number>(); // 自己查过、又预读过的同一处只标一次
    for (const rec of recs) {
      const words = rec.sentence.split(/\s+/).filter(Boolean).map(escRe);
      if (!words.length) continue;
      const sm = new RegExp(words.join('\\s+'), 'i').exec(model.text);
      if (!sm) continue;
      const inSentence = lower.slice(sm.index, sm.index + sm[0].length);
      const wm = new RegExp(`\\b${escRe(rec.text.toLowerCase()).replace(/\s+/g, '\\s+')}\\b`).exec(
        inSentence,
      );
      if (!wm) continue;
      const start = sm.index + wm.index;
      if (taken.has(start)) continue;
      taken.add(start);
      targets.push({ start, end: start + wm[0].length, rec });
    }
    const gloss = st.vocabMarkStyle === 'gloss';
    const labelOf = (answer: string) => (gloss ? meaningOf(answer) || '●' : '●');
    const want = new Map(targets.map((t) => [`${t.start}:${t.end}`, t]));
    let removed = false;
    for (const ruby of [...doc.querySelectorAll(`ruby.${OUR_CLASS}`)]) {
      const { first, len } = baseOf(ruby);
      const start = model.offsetOf(first);
      const key = `${start}:${start + len}`;
      const t = start >= 0 ? want.get(key) : undefined;
      if (!t) {
        unwrapOne(ruby);
        removed = true;
        continue;
      }
      want.delete(key);
      const rt = ruby.querySelector('rt') as HTMLElement | null;
      const label = labelOf(t.rec.answer);
      if (rt && (rt.textContent !== label || rt.style.fontWeight !== (gloss ? 'normal' : 'bold'))) {
        rt.textContent = label;
        styleRt(rt, gloss);
      }
    }
    if (!want.size) return;
    if (removed) model = textModel(doc); // 拆过的地方文字节点变了，重新算位置
    // 从后往前包，前面的位置不受影响
    const todo = [...want.values()].sort((a, b) => b.start - a.start);
    for (const t of todo) {
      const s = model.locate(t.start);
      const e = model.locate(t.end, true);
      if (!s || !e || s.node !== e.node) continue;
      const label = labelOf(t.rec.answer);
      const lens = s.node.parentElement?.closest(`ruby.${LENS_CLASS}`) as HTMLElement | null;
      if (lens && !lens.classList.contains(OUR_CLASS)) {
        // 同一个词透镜也标了：换成我们的（只显示一层），记下透镜原来的提示，清掉时还原
        const rt = lens.querySelector('rt') as HTMLElement | null;
        lens.setAttribute('data-odybo-lens', rt?.textContent ?? '');
        lens.classList.add(OUR_CLASS);
        if (rt) {
          rt.textContent = label;
          styleRt(rt, gloss);
        }
        continue;
      }
      const range = doc.createRange();
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
      const ruby = doc.createElement('ruby');
      ruby.className = `${LENS_CLASS} ${OUR_CLASS}`;
      ruby.setAttribute('cfi-skip', '');
      const rt = doc.createElement('rt');
      rt.setAttribute('cfi-inert', '');
      rt.textContent = label;
      styleRt(rt, gloss);
      try {
        ruby.appendChild(range.extractContents());
        ruby.appendChild(rt);
        range.insertNode(ruby);
      } catch {
        // 文档同时被改了：这一个不标
      }
    }
  } catch (e) {
    console.warn('[odybo] 标生词失败', e);
  }
};

/** 预读完、改了设置之后：把打开着的章节重新标一遍（只标这本书的；不传就全部）。 */
export const remarkOpenDocs = (book?: string) => {
  for (const [doc, b] of [...docs]) {
    if (!doc.defaultView) {
      docs.delete(doc); // 章节已经关掉
      continue;
    }
    if (!book || b === book) void markVocabInDoc(doc, b);
  }
};

/** 书的名字，和查词时一样的写法（书名 / 作者），记录都按它存 */
export const odyboBookName = (book?: { title?: string; author?: string } | null) =>
  [book?.title, book?.author].filter(Boolean).join(' / ');

/** 点的是不是我们标的生词（是的话算自己查，进生词本） */
export const isOurMark = (el: Element | null) => !!el?.classList.contains(OUR_CLASS);
