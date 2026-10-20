// Builds the "reader context" that is sent along with a text selection (used by AI translate / dictionary).
// Instead of a few characters around the selection, it returns the whole paragraph that contains the selection,
// plus the previous and the next paragraph, capped at `maxChars`.
//  - PDF (pdf.js text layer): the text layer is a pile of absolutely positioned spans, so lines and paragraphs are
//    rebuilt from their on-screen geometry (columns, indents, line gaps, hyphenated line ends).
//  - EPUB and other reflowable books: the nearest block element, plus the previous / next text block.
// Returns '' when nothing sensible can be built; the caller then falls back to the old behaviour.

// ---------- paragraph rebuilding for the PDF text layer (pure functions, no DOM) ----------

const median = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((p, q) => p - q);
  return b[Math.floor(b.length / 2)];
};

// items: [{ t: text, r: { left, right, top, bottom, width, height }, f: fontFamily }]
// Groups the pieces into rows by vertical position, splits two-column pages at the gutter, and returns lines
// in reading order (left column top to bottom, then right column).
export const buildLines = (items) => {
  // 1. rows: pieces at the same height
  const sorted = items
    .slice()
    .sort((a, b) => (a.r.top + a.r.bottom) / 2 - (b.r.top + b.r.bottom) / 2 || a.r.left - b.r.left);
  const rows = [];
  for (const it of sorted) {
    const cy = (it.r.top + it.r.bottom) / 2;
    const h = Math.max(1, it.r.height);
    const row = rows.length ? rows[rows.length - 1] : null;
    if (row && Math.abs(cy - row.cy) < Math.min(h, row.h) * 0.5) row.items.push(it);
    else rows.push({ items: [it], cy, h });
  }
  // the height of a row is the height of the piece holding most of its characters: a small superscript or an
  // italic fragment at the start of a line must not make the whole line look like a different font size
  for (const row of rows) {
    let best = row.items[0];
    for (const it of row.items) if (it.t.length > best.t.length) best = it;
    row.h = Math.max(1, best.r.height);
  }
  // 2. column gutters by vertical projection over the whole page. x is a gutter when (almost) no row has ink there while
  //    at least three rows have ink on its left and three on its right. The two columns do not need to share a row
  //    (their baselines are often a few pixels apart), hanging indents and ragged line ends do not matter, and the
  //    word gaps of justified text never line up for most rows, so single-column text has no gutter.
  for (const row of rows) {
    row.items.sort((a, b) => a.r.left - b.r.left);
    row.left = row.items[0].r.left;
    row.right = Math.max(...row.items.map((it) => it.r.right));
  }
  const hMed = median(rows.map((r) => r.h));
  const minX = Math.floor(Math.min(...rows.map((r) => r.left)));
  const maxX = Math.ceil(Math.max(...rows.map((r) => r.right)));
  const W = maxX - minX + 2;
  const inkDiff = new Int32Array(W + 2); // rows with ink at x
  const spanDiff = new Int32Array(W + 2); // rows with text on both sides of x (ink or not)
  const lastAt = new Int32Array(W + 2); // histogram of row.right: rows lying completely left of x
  const firstAt = new Int32Array(W + 2); // histogram of row.left: rows lying completely right of x
  for (const row of rows) {
    let l = row.items[0].r.left;
    let r = row.items[0].r.right;
    const mark = (from, to) => {
      inkDiff[Math.max(0, Math.floor(from - minX))]++;
      inkDiff[Math.min(W, Math.ceil(to - minX) + 1)]--;
    };
    for (const it of row.items) {
      if (it.r.left <= r + 1) r = Math.max(r, it.r.right);
      else {
        mark(l, r);
        l = it.r.left;
        r = it.r.right;
      }
    }
    mark(l, r);
    const from = Math.floor(row.left - minX) + 1;
    const to = Math.ceil(row.right - minX) - 1;
    if (to >= from) {
      spanDiff[from]++;
      spanDiff[Math.min(W, to + 1)]--;
    }
    lastAt[Math.min(W, Math.ceil(row.right - minX))]++;
    firstAt[Math.max(0, Math.floor(row.left - minX))]++;
  }
  const gutters = []; // [x0, x1] channels
  {
    const total = rows.length;
    const leftOf = new Int32Array(W + 2); // rows with row.right < x
    const rightOf = new Int32Array(W + 2); // rows with row.left > x
    for (let x = 1; x <= W; x++) leftOf[x] = leftOf[x - 1] + lastAt[x - 1];
    for (let x = W - 1; x >= 0; x--) rightOf[x] = rightOf[x + 1] + firstAt[x + 1];
    const minWidth = Math.max(hMed * (total < 12 ? 1 : 0.6), 4);
    let ink = 0;
    let span = 0;
    let start = -1;
    for (let x = 0; x <= W; x++) {
      ink += inkDiff[x];
      span += spanDiff[x];
      const both = Math.max(0, span - ink); // rows with text on both sides but no ink at x
      const free = x < W && ink <= 0.12 * total && leftOf[x] + both >= 3 && rightOf[x] + both >= 3;
      if (free && start < 0) start = x;
      if (!free && start >= 0) {
        if (x - start >= minWidth) gutters.push([start + minX, x - 1 + minX]);
        start = -1;
      }
    }
  }
  const gutterBetween = (prev, it) =>
    gutters.some(([x0, x1]) => prev.r.right <= x1 && it.r.left >= x0 && it.r.left > prev.r.right);
  const lines = [];
  for (const row of rows) {
    let seg = null;
    let prev = null;
    for (const it of row.items) {
      if (!seg || gutterBetween(prev, it)) {
        seg = {
          items: [],
          cy: row.cy,
          h: row.h,
          top: it.r.top,
          bottom: it.r.bottom,
          left: it.r.left,
          right: it.r.right,
        };
        lines.push(seg);
      }
      seg.items.push(it);
      seg.top = Math.min(seg.top, it.r.top);
      seg.bottom = Math.max(seg.bottom, it.r.bottom);
      seg.right = Math.max(seg.right, it.r.right);
      prev = prev && prev.r.right > it.r.right ? prev : it;
    }
  }
  // 3. columns are the stretches between gutters; a line that does not fit inside one of them (a title across the
  //    page) is col -1 and cuts the page into bands
  const bounds = [-Infinity, ...gutters.flatMap(([x0, x1]) => [x0, x1]), Infinity];
  const colOf = (ln) => {
    for (let i = 0; i + 1 < bounds.length; i += 2) {
      if (ln.left >= bounds[i] - 2 && ln.right <= bounds[i + 1] + 2) return i / 2;
    }
    return -1;
  };
  const colBox = new Map();
  for (const ln of lines) {
    ln.col = gutters.length ? colOf(ln) : 0;
    const box = colBox.get(ln.col) || { left: Infinity, right: -Infinity };
    box.left = Math.min(box.left, ln.left);
    box.right = Math.max(box.right, ln.right);
    colBox.set(ln.col, box);
  }
  const pageL = Math.min(...lines.map((l) => l.left));
  const pageR = Math.max(...lines.map((l) => l.right));
  for (const ln of lines) {
    const c = ln.col >= 0 && gutters.length ? colBox.get(ln.col) : { left: pageL, right: pageR };
    ln.colLeft = c.left;
    ln.colRight = c.right;
  }
  const spans = lines.filter((l) => l.col === -1).map((l) => l.cy);
  for (const ln of lines) {
    const above = spans.filter((cy) => cy < ln.cy).length;
    ln.band = ln.col === -1 ? above * 2 + 1 : above * 2;
  }
  lines.sort((a, b) => a.band - b.band || a.col - b.col || a.cy - b.cy);
  for (const line of lines) {
    line.items.sort((a, b) => a.r.left - b.r.left);
    let text = '';
    line.parts = []; // where each piece starts inside the line text
    let prev = null;
    for (const it of line.items) {
      if (prev) {
        const gap = it.r.left - prev.r.right;
        if (gap > line.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.t)) text += ' ';
      }
      line.parts.push({ it, start: text.length });
      text += it.t;
      prev = it;
    }
    line.text = text.replace(/\s+$/, '');
    const fc = {};
    for (const it of line.items) if (it.f) fc[it.f] = (fc[it.f] || 0) + it.t.length;
    line.font = Object.keys(fc).sort((a, b) => fc[b] - fc[a])[0] || '';
    line.left = line.items[0].r.left;
    line.right = line.items[line.items.length - 1].r.right;
  }
  return lines;
};

// A new paragraph starts at: a big line gap, an indented first line, a font size change, a short line that ends a
// sentence, a short unpunctuated line followed by a capital (a heading), or a column change after a finished sentence.
// Words hyphenated at the end of a line are joined back.
// Running heads and page numbers sit at the very top / bottom of a column: a short line, separated from the text by a
// gap, in a different font size or carrying a page number. They are dropped so they never end up inside a paragraph.
const dropEdgeNoise = (lines) => {
  if (lines.length < 6) return lines;
  const hMed = median(lines.map((l) => l.h));
  const groups = new Map();
  lines.forEach((l, i) => {
    if (l.col === -1) return;
    const k = l.band + ':' + l.col;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const drop = new Set();
  // pitch: the usual distance between the tops of two lines of this column
  const noise = (line, gap, pitch) =>
    line.text.length < 60 &&
    gap > line.h * 0.5 &&
    (Math.abs(line.h - hMed) > hMed * 0.15 || // a different font size
      (line.text.length < 40 && /(^\\s*\\d{1,4}\\b)|(\\b\\d{1,4}\\s*$)/.test(line.text)) || // carries a page number
      (line.text.length < 50 && gap > pitch * 1.2)); // set apart from the text by more than a line
  for (const idxs of groups.values()) {
    if (idxs.length < 4) continue;
    const tops = [];
    for (let k = 1; k < idxs.length; k++) tops.push(lines[idxs[k]].top - lines[idxs[k - 1]].top);
    const pitch = median(tops);
    const first = lines[idxs[0]];
    const second = lines[idxs[1]];
    const last = lines[idxs[idxs.length - 1]];
    const beforeLast = lines[idxs[idxs.length - 2]];
    if (noise(first, second.top - first.bottom, pitch)) drop.add(idxs[0]);
    if (noise(last, last.top - beforeLast.bottom, pitch)) drop.add(idxs[idxs.length - 1]);
  }
  return drop.size ? lines.filter((_, i) => !drop.has(i)) : lines;
};

export const buildParagraphs = (allLines) => {
  const lines = dropEdgeNoise(allLines);
  if (!lines.length) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].col === lines[i - 1].col) gaps.push(lines[i].top - lines[i - 1].bottom);
  }
  const g = median(gaps.filter((x) => x > -5));
  const h = median(lines.map((l) => l.h));
  const paras = [];
  let cur = null;
  // A figure caption or a note at the top of the next column can sit between an unfinished sentence and its
  // continuation: the caption becomes a paragraph of its own (stray) and the continuation goes back to the sentence.
  let pending = null;
  let joinAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let newPara = !cur;
    if (cur && pending && i === joinAt) {
      cur = pending;
      pending = null;
      newPara = false;
    } else if (cur) {
      const prev = lines[i - 1];
      const minLeft = ln.colLeft;
      const maxRight = ln.colRight;
      const ended = /[.!?:]["”’')\]]*$/.test(prev.text);
      if (ln.col !== prev.col) {
        // the sentence goes on in the next column: no full stop before, a lowercase letter after
        const goesOn = !ended && /^[a-z]/.test(ln.text);
        newPara =
          ln.col === -1 ||
          prev.col === -1 ||
          (!goesOn && (ended || prev.right < prev.colRight - h * 3));
        if (!newPara && !goesOn) {
          for (let j = i + 1; j <= i + 2 && j < lines.length && lines[j].col === ln.col; j++) {
            if (
              /^[a-z]/.test(lines[j].text) &&
              lines.slice(i, j).every((l) => l.text.length < 80) &&
              lines[j].top - lines[j - 1].bottom > g + h * 0.5
            ) {
              newPara = true;
              pending = cur;
              joinAt = j;
              break;
            }
          }
        }
      } else if (ln.top - prev.bottom > Math.max(g * 1.8, g + h * 0.5)) newPara = true;
      // an indented line starts a paragraph only after a finished sentence or with a capital: interviews and
      // bibliographies use a hanging indent (first line flush left, the rest indented) and must not be cut up
      else if (
        ln.left - minLeft > h * 0.8 &&
        prev.left - minLeft < h * 0.4 &&
        (ended || /^[A-Z0-9“"‘'(]/.test(ln.text))
      )
        newPara = true;
      // a different box height means a different font size, but some PDFs give a few ordinary lines a taller box
      // (the glyphs look the same): a sentence that goes on in lowercase is not cut there
      else if (
        Math.abs(ln.h - prev.h) > Math.max(prev.h, ln.h) * 0.15 &&
        (ended || !/^[a-z]/.test(ln.text))
      )
        newPara = true;
      else if (ended && prev.right < maxRight - h * 3) newPara = true;
      else if (
        prev.right < maxRight - h * 3 &&
        !/[,;\-–—]$/.test(prev.text) &&
        /^[A-Z0-9“"(]/.test(ln.text) &&
        ((prev.font && ln.font && prev.font !== ln.font) ||
          (prev.right - minLeft < (maxRight - minLeft) * 0.65 &&
            prev.text.split(/\s+/).length <= 10))
      )
        newPara = true;
    }
    if (newPara) {
      cur = { text: '', lines: [], stray: !!pending };
      paras.push(cur);
    } else if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(ln.text)) {
      cur.text = cur.text.slice(0, -1);
    } else {
      cur.text += ' ';
    }
    cur.lines.push({ ln, start: cur.text.length });
    cur.text += ln.text;
  }
  return paras;
};

// ---------- fitting paragraphs into the size budget ----------

// 软连字符（U+00AD）是阅读器为了两端对齐自动插进单词里的断字点，不是原文：去掉
const clean = (s) =>
  String(s || '')
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const keepTail = (s, n) => (s.length <= n ? s : s.slice(s.length - n).replace(/^\S*\s/, ''));
const keepHead = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s\S*$/, ''));

// before / after: neighbouring paragraphs; mid: the paragraph(s) holding the selection;
// pos: index of the selection start inside mid (raw text, before whitespace is collapsed)
export const composeContext = (parts, maxChars = 2000) => composeContextInfo(parts, maxChars).text;

// 同 composeContext，另外给出选中处在结果里的位置 at（截掉了就是 -1）：
// 在选中处插一个记号字符，跟着一起压空白、截取，最后找记号的位置再把它去掉
const MARK = '\u0001';
export const composeContextInfo = (
  { before = '', mid = '', after = '', pos = 0 },
  maxChars = 2000,
) => {
  const pre = clean(mid.slice(0, pos)).length;
  let m = clean(mid.slice(0, pos) + MARK + mid.slice(pos));
  const midMax = Math.floor(maxChars * 0.7);
  if (m.length > midMax) {
    const a = Math.max(0, Math.min(m.length - midMax, pre - Math.floor(midMax / 2)));
    m = m.slice(a, a + midMax);
    if (a > 0) m = m.replace(/^\S*\s/, '');
    m = m.replace(/\s\S*$/, '');
  }
  let b = clean(before);
  let c = clean(after);
  const room = maxChars - m.length - 4;
  if (b.length + c.length > room) {
    const half = Math.floor(room / 2);
    if (b.length < half) c = keepHead(c, room - b.length);
    else if (c.length < half) b = keepTail(b, room - c.length);
    else {
      b = keepTail(b, half);
      c = keepHead(c, half);
    }
  }
  const k = m.indexOf(MARK);
  m = m.replace(MARK, '');
  const text = [b, m, c].filter(Boolean).join('\n\n');
  return { text, at: k < 0 ? -1 : (b ? b.length + 2 : 0) + k };
};

// ---------- DOM glue ----------

const elementOf = (node) => (node && node.nodeType === 1 ? node : node?.parentElement || null);

const rectOf = (el) => {
  const b = el.getBoundingClientRect();
  return {
    left: b.left,
    right: b.right,
    top: b.top,
    bottom: b.bottom,
    width: b.width,
    height: b.height,
  };
};

// the pdf.js text layer: [{ t, r, el, f }] for every leaf span that has text
// A run that is much wider than a column may hold the text of two columns line by line (some PDFs are stored that
// way), so it is cut into words, each with its own position; the gutter then shows up as a gap between words.
const splitWords = (it) => {
  const node = it.el.firstChild;
  if (!node || node.nodeType !== 3 || it.el.childNodes.length !== 1) return [it];
  const range = node.ownerDocument.createRange();
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(node.data))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const b = range.getBoundingClientRect();
    if (!(b.width > 0)) return [it];
    words.push({
      t: m[0],
      r: {
        left: b.left,
        right: b.right,
        top: it.r.top,
        bottom: it.r.bottom,
        width: b.width,
        height: it.r.height,
      },
      el: it.el,
      f: it.f,
      base: m.index,
    });
  }
  if (words.length < 2) return [it];
  words.forEach((w, i) => {
    if (i < words.length - 1) w.t += ' ';
  });
  return words;
};

// the pdf.js text layer: [{ t, r, el, f, base }] for every leaf span that has text (base: offset of t inside the span)
export const pdfItems = (layer) => {
  const items = Array.from(layer.querySelectorAll('span'))
    .filter((s) => s.childElementCount === 0 && s.textContent && s.textContent.trim())
    .map((el) => ({ t: el.textContent, r: rectOf(el), el, f: el.style.fontFamily || '', base: 0 }));
  const shown = items.filter((it) => it.r.width > 0);
  if (!shown.length) return items;
  const wide =
    (Math.max(...shown.map((it) => it.r.right)) - Math.min(...shown.map((it) => it.r.left))) * 0.45;
  const out = [];
  for (const it of items) {
    if (it.r.width >= wide) out.push(...splitWords(it));
    else out.push(it);
  }
  return out;
};

// where a (node, offset) boundary sits: { pi: paragraph index, at: index inside that paragraph's text }
const locateBoundary = (paras, items, node, offset) => {
  let el = elementOf(node);
  if (node.nodeType === 1) {
    // boundary on an element: use the child it points at
    el = node.childNodes[Math.min(offset, node.childNodes.length - 1)] || node;
    el = elementOf(el);
    offset = 0;
  }
  let item = null;
  let rel = 0;
  const own = items.filter((it) => it.el === el);
  if (own.length) {
    // a run may have been cut into words: take the last word that starts at or before the offset
    item = own[0];
    for (const it of own) if (it.base <= offset) item = it;
    rel = Math.max(0, offset - item.base);
  } else {
    item = items.find((it) => it.el.contains(el));
  }
  if (!item) return null;
  for (let pi = 0; pi < paras.length; pi++) {
    for (const { ln, start } of paras[pi].lines) {
      const part = ln.parts.find((p) => p.it === item);
      if (part)
        return {
          pi,
          at: Math.min(paras[pi].text.length, start + part.start + Math.min(rel, item.t.length)),
        };
    }
  }
  return null;
};

const pdfContext = (range, maxChars) => {
  const layer = elementOf(range.startContainer)?.closest?.('.textLayer');
  if (!layer) return '';
  const items = pdfItems(layer);
  // a page that is not laid out (hidden) reports all-zero rectangles; geometry is useless then
  if (!items.some((it) => it.r.width > 0 && it.r.height > 0)) return '';
  const paras = buildParagraphs(buildLines(items));
  const s = locateBoundary(paras, items, range.startContainer, range.startOffset);
  if (!s) return '';
  let e = locateBoundary(paras, items, range.endContainer, range.endOffset);
  if (!e || e.pi < s.pi) e = s;
  // neighbours skip figure captions that were cut out of a sentence (unless the selection itself is one)
  const near = (i, step) => {
    for (let k = i + step; k >= 0 && k < paras.length; k += step)
      if (!paras[k].stray) return paras[k].text;
    return '';
  };
  const mid = paras
    .slice(s.pi, e.pi + 1)
    .map((p) => p.text)
    .join(' ');
  return composeContextInfo(
    { before: near(s.pi, -1), mid, after: near(e.pi, 1), pos: s.at },
    maxChars,
  );
};

const BLOCK_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, td, th, pre, figcaption, div';

const epubContext = (range, maxChars) => {
  const doc = range.startContainer.ownerDocument;
  const body = doc?.body;
  if (!body) return '';
  const leaves = Array.from(body.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) => !el.querySelector(BLOCK_SELECTOR) && el.textContent.trim(),
  );
  const si = leaves.findIndex((el) => el.contains(range.startContainer));
  if (si < 0) return '';
  let ei = leaves.findIndex((el) => el.contains(range.endContainer));
  if (ei < si) ei = si;
  const pre = doc.createRange();
  pre.selectNodeContents(leaves[si]);
  pre.setEnd(range.startContainer, range.startOffset);
  const mid = leaves
    .slice(si, ei + 1)
    .map((el) => el.textContent)
    .join(' ');
  // blocks hidden by the book's CSS (display: none, e.g. note labels) are in the DOM but not on the page: skip them
  const neighbour = (from, step) => {
    for (let i = from + step, n = 0; i >= 0 && i < leaves.length && n < 40; i += step, n++) {
      if (leaves[i].getClientRects().length > 0) return leaves[i].textContent;
    }
    return '';
  };
  return composeContextInfo(
    { before: neighbour(si, -1), mid, after: neighbour(ei, 1), pos: pre.toString().length },
    maxChars,
  );
};

// { text: 上下文, at: 选中处在 text 里的位置（-1 = 不知道） }；建不出来时 text 为空
export const buildContextInfo = (range, { maxChars = 2000 } = {}) => {
  const none = { text: '', at: -1 };
  if (!range) return none;
  const r = pdfContext(range, maxChars) || epubContext(range, maxChars);
  return r && r.text ? r : none;
};

export const buildContextText = (range, opts) => buildContextInfo(range, opts).text;
