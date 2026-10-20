// 把 AI 的回答排成和电脑小工具一样的样子（照 ctx_lookup.py 的 _render_main）：
// 栏目名单独一行、粉色加粗；【这里的意思】【翻译】大字加粗；【整句翻译】浅蓝；
// 【词组短语】【难点】【时态】【句子拆解】每条「英文 —— 中文」英文用黄色；
// 内容是「无」的栏目整栏不显示；【原形】不显示；最后附上原句，选中的部分粉色加粗，词组短语加下划线。

interface Palette {
  label: string;
  main: string;
  trans: string;
  phr: string;
  dim: string;
}

const DARK: Palette = {
  label: '#f28bae',
  main: '#ffffff',
  trans: '#c6dafc',
  phr: '#fdd663',
  dim: '#9aa0a6',
};
const LIGHT: Palette = {
  label: '#c2185b',
  main: 'inherit',
  trans: '#1a56b0',
  phr: '#9a6700',
  dim: '#6b7280',
};

const LIST_SECTIONS = new Set(['词组短语', '难点', '时态', '句子拆解']);
const NONE = new Set(['无', '无。', '没有']);

interface Section {
  label: string;
  lines: string[];
}

/** 拆成「开头那行（音标）」和若干栏目；没写完的最后一行先不算（流式时可能只到一半）。 */
const parse = (answer: string, done: boolean) => {
  let lines = answer.split('\n');
  if (!done) lines = lines.slice(0, -1);
  const head: string[] = [];
  const sections: Section[] = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^【([^】]+)】\s*(.*)$/);
    if (m) {
      sections.push({ label: m[1]!, lines: m[2] ? [m[2]] : [] });
    } else if (sections.length) {
      sections[sections.length - 1]!.lines.push(s);
    } else {
      head.push(s);
    }
  }
  return { head, sections };
};

const isEmptySection = (sec: Section) =>
  sec.lines.length === 0 || sec.lines.every((l) => NONE.has(l.replace(/^[-•·*\s]+/, '').trim()));

/** 「句子拆解」只有一行（整句原样抄一遍）时也不显示，和小工具一样。 */
const isTrivialBreakdown = (sec: Section) =>
  sec.label === '句子拆解' && sec.lines.filter((l) => !NONE.has(l.trim())).length <= 1;

const el = (tag: string, text: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const e = document.createElement(tag);
  e.textContent = text;
  Object.assign(e.style, style);
  return e;
};

const phraseLine = (s: string, c: Palette, phrases: string[], label: string) => {
  const line = s.replace(/^\s*(?:[-•·*]|\d+[.、)])\s*/, '');
  const p = el('div', '', { marginTop: '2px' });
  const parts = line.split(/\s*(?:——|—|--)\s*/);
  if (parts.length >= 2 && /[A-Za-z]/.test(parts[0]!)) {
    const en = parts[0]!.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    const tense = label === '时态' ? en.match(/^(.*?)\s*([（(][^）)]*[）)])$/) : null;
    if (tense) {
      p.append(
        el('span', tense[1]!, { color: c.phr, fontWeight: '600' }),
        el('span', ` ${tense[2]}`, { color: c.dim }),
      );
    } else {
      p.append(el('span', en, { color: c.phr, fontWeight: '600' }));
    }
    if (label === '词组短语') phrases.push(en);
    p.append(document.createTextNode(`  ${parts.slice(1).join(' —— ')}`));
  } else {
    p.textContent = line;
  }
  return p;
};

/** 原句：选中的部分粉色加粗，词组短语（包括 too ... to 这种隔开的）加下划线。 */
const sentenceView = (sentence: string, word: string, phrases: string[], c: Palette) => {
  const low = sentence.toLowerCase();
  const marks = Array.from({ length: sentence.length }, () => ({ hl: false, ul: false }));
  const w = word.trim().toLowerCase();
  const k = w ? low.indexOf(w) : -1;
  if (k >= 0) for (let i = k; i < k + w.length; i++) marks[i]!.hl = true;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = (part: string) =>
    new RegExp(
      `\\b${part
        .split(/\s+/)
        .filter(Boolean)
        .map((wd) => {
          const base = wd.endsWith('e') && wd.length > 3 ? wd.slice(0, -1) : wd;
          return `(?:${esc(wd)}|${esc(base)}(?:s|es|ed|d|ing))`;
        })
        .join('\\s+')}\\b`,
    );
  for (const ph of phrases) {
    let pos = 0;
    const spans: [number, number][] = [];
    for (const part of ph
      .toLowerCase()
      .split(/\.{2,}|…+/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const m = low.slice(pos).match(wordRe(part));
      if (!m || m.index === undefined) {
        spans.length = 0;
        break;
      }
      spans.push([pos + m.index, pos + m.index + m[0].length]);
      pos += m.index + m[0].length;
    }
    for (const [a, b] of spans) for (let i = a; i < b; i++) marks[i]!.ul = true;
  }
  const box = el('div', '', { fontStyle: 'italic', color: c.dim, marginTop: '2px' });
  let i = 0;
  while (i < sentence.length) {
    const { hl, ul } = marks[i]!;
    let j = i + 1;
    while (j < sentence.length && marks[j]!.hl === hl && marks[j]!.ul === ul) j++;
    const span = el('span', sentence.slice(i, j));
    if (hl) Object.assign(span.style, { color: c.label, fontWeight: '700' });
    if (ul) span.style.textDecoration = 'underline';
    box.append(span);
    i = j;
  }
  return box;
};

export const renderAnswer = (
  container: HTMLElement,
  answer: string,
  opts: { word: string; sentence: string; done: boolean; dark?: boolean },
) => {
  const c = opts.dark === false ? LIGHT : DARK;
  const { head, sections } = parse(answer, opts.done);
  const root = el('div', '', { lineHeight: '1.6' });
  const phrases: string[] = [];
  if (head.length) {
    // 开头那行：音标和词性，灰色
    root.append(el('div', head.join(' ').replace(/^\*\s*/, ''), { color: c.dim }));
  }
  let first = !head.length;
  for (const sec of sections) {
    if (sec.label === '原形' || isEmptySection(sec) || isTrivialBreakdown(sec)) continue;
    root.append(
      el('div', sec.label, {
        color: c.label,
        fontWeight: '700',
        fontSize: '0.85em',
        marginTop: first ? '0' : '10px',
      }),
    );
    first = false;
    for (const line of sec.lines) {
      if (LIST_SECTIONS.has(sec.label)) {
        root.append(phraseLine(line, c, phrases, sec.label));
      } else if (sec.label === '这里的意思' || sec.label === '翻译') {
        root.append(el('div', line, { color: c.main, fontWeight: '700', fontSize: '1.1em' }));
      } else if (sec.label === '整句翻译') {
        root.append(el('div', line, { color: c.trans }));
      } else if (sec.label === '其他常见意思') {
        root.append(el('div', line, { color: c.dim }));
      } else {
        root.append(el('div', line));
      }
    }
  }
  if (!opts.done) {
    root.append(el('div', answer ? '…' : '正在查询…', { color: c.dim, marginTop: '4px' }));
  } else if (opts.sentence && sections.length) {
    root.append(
      el('div', '原句', {
        color: c.label,
        fontWeight: '700',
        fontSize: '0.85em',
        marginTop: '10px',
      }),
    );
    root.append(sentenceView(opts.sentence, opts.word, phrases, c));
  }
  container.replaceChildren(root);
};

/** 从上下文里找出选中内容所在的那一句（照 ctx_lookup.py 的 pick_sentence）。 */
export const pickSentence = (block: string, word: string) => {
  if (!block) return '';
  const parts = block.split(/\n{2,}/).flatMap((p) => p.split(/(?<=[.!?。”"])\s+(?=[A-Z“"(])/));
  const wl = word.replace(/\s+/g, ' ').trim().toLowerCase();
  const hit = parts.find((p) => p.toLowerCase().includes(wl));
  if (hit) return hit.trim();
  const first = wl.split(' ')[0];
  return (first && parts.find((p) => p.toLowerCase().includes(first))?.trim()) || '';
};
