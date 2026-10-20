// 在书里标出预读过的生词：照单词透镜的做法，把词包成 <ruby class="wl-gloss odybo-vocab">词<rt>标注</rt></ruby>。
// 标注是这一句里的解释（「生词标法」= 解释），或一个带颜色的点（= 点）。
// 用透镜的 class（wl-gloss），点一下就走透镜那条路：Readest 替你选中这个词再查，出来的是我们的语境查词。
// 标两种：「生词预读」预读过的（同一本书、同一个词、同一句），和自己查过的单词、短语（点透镜查的不算，透镜自己有小字）。
// 都是按那一句存的，所以解释一定是这一句里的意思。忽略了的词不标。
// 只用于 EPUB 这类能重排的书（和透镜一样，PDF 不做）。
// 接入点：FoliateViewer.tsx 每次透镜刷新完一章后调用 markVocabInDoc(doc, book)。
import { HISTORY, PREFETCH, listByBook, type HistoryRecord, type PrefetchRecord } from './history';
import { getSettings } from './settings';
import { isIgnored, isVocab, lemmaOf } from './vocab';

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
    .split(/[，；,;、（(]/)[0]!
    .trim();
  return first.length > 8 ? `${first.slice(0, 8)}…` : first;
};

/** 去掉我们上一次的标注（透镜的不动；原来是透镜的，还原成透镜的样子） */
const clearOurs = (doc: Document) => {
  doc.querySelectorAll(`ruby.${OUR_CLASS}`).forEach((ruby) => {
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
  });
  (doc.body ?? doc.documentElement)?.normalize();
};

/** 章节里所有正文文字拼起来（透镜包过的词也算，标注小字 rt 不算），记下每一段在哪个文字节点 */
const textModel = (doc: Document) => {
  const root = doc.body ?? doc.documentElement;
  const segs: { node: Text; start: number }[] = [];
  let text = '';
  if (!root) return { text, locate: () => null as { node: Text; offset: number } | null };
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
  const locate = (offset: number) => {
    let found: { node: Text; start: number } | null = null;
    for (const s of segs) {
      if (s.start <= offset) found = s;
      else break;
    }
    return found ? { node: found.node, offset: offset - found.start } : null;
  };
  return { text, locate };
};

const styleRt = (rt: HTMLElement, gloss: boolean) => {
  Object.assign(rt.style, {
    color: '#e8649a',
    fontSize: gloss ? '0.55em' : '0.6em',
    fontWeight: gloss ? 'normal' : 'bold',
  });
};

/** 标出这一章里预读过的生词。 */
export const markVocabInDoc = async (doc: Document, book: string) => {
  docs.set(doc, book);
  try {
    clearOurs(doc);
    const st = getSettings();
    if (!st.vocabPrefetch) return; // 生词预读关着：不标
    const pre = (await listByBook<PrefetchRecord>(PREFETCH, book)).filter((r) => r.kind === 'word');
    const own = (await listByBook<HistoryRecord>(HISTORY, book))
      .filter((r) => r.source !== 'lens' && r.sentence && isVocab(r.word))
      .map((r) => ({ text: r.word, sentence: r.sentence, answer: r.answer }));
    const recs = [...own, ...pre].filter(
      (r) => !isIgnored(lemmaOf({ word: r.text, answer: r.answer })),
    );
    if (!recs.length || !doc.defaultView) return;
    clearOurs(doc); // 等记录的这段时间里可能又标过一次
    const model = textModel(doc);
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
    // 从后往前包，前面的位置不受影响
    targets.sort((a, b) => b.start - a.start);
    for (const t of targets) {
      const s = model.locate(t.start);
      const e = model.locate(t.end);
      if (!s || !e || s.node !== e.node) continue;
      const gloss = st.vocabMarkStyle === 'gloss';
      const label = gloss ? meaningOf(t.rec.answer) || '●' : '●';
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
