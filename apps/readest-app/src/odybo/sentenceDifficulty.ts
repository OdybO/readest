// 句子难不难：单词都懂的情况下，这句话的结构会不会让人卡住（开发者 10-24：预读只给难句，省 AI 额度）。
// 纯规则（正则 + 小词表），不问 AI，一句不到 1 毫秒。返回分数和得分理由，句子预读按「难句分数线」决定问不问
// （prefetch.ts），理由存进预读记录，以后拿「预读了有没有点开」来调分。
// 来源：派 Codex、agy 各想一套（D:\Tools\CtxLookup\讨论-句子难度\），取 agy 的路子——只重罚少数几种卡人的结构，
// 长度最多 +2，平铺并列扣分；补上两家都漏的：几处被动连着、下一句接着解释这一句、have had。
// 生词不在这里算（生词预读另外管）；短语表只放字面意思猜不出的常见短语，不照着开发者查过的词挑。

export interface Difficulty {
  score: number;
  reasons: string[];
}

const PRON = new Set([
  'i',
  'you',
  'we',
  'they',
  'he',
  'she',
  'it',
  'one',
  'someone',
  'people',
  'players',
]);
const DET = new Set([
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their',
  'some',
  'any',
  'every',
  'each',
  'no',
  'many',
  'most',
  'all',
  'both',
]);
const AUX = new Set([
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'am',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
]);
// 常见的主句谓语（找「长主语」时，看第一个谓语来得多晚）
const MAIN_VERB = new Set([
  ...AUX,
  'means',
  'makes',
  'requires',
  'helps',
  'leads',
  'takes',
  'seems',
  'becomes',
  'gives',
  'allows',
  'needs',
  'matters',
  'depends',
  'involves',
  'includes',
  'creates',
  'provides',
  'remains',
]);
const PREP = new Set([
  'of',
  'in',
  'on',
  'at',
  'for',
  'from',
  'with',
  'by',
  'about',
  'under',
  'over',
  'between',
  'within',
  'without',
  'through',
  'into',
  'upon',
  'during',
  'across',
  'toward',
  'towards',
  'among',
  'beyond',
]);
const SAY_VERB = new Set([
  'say',
  'says',
  'said',
  'think',
  'thinks',
  'thought',
  'believe',
  'believes',
  'mean',
  'means',
  'meant',
  'ensure',
  'ensures',
  'know',
  'knows',
  'knew',
  'find',
  'finds',
  'found',
  'show',
  'shows',
  'showed',
  'suggest',
  'suggests',
  'realize',
  'realized',
  'note',
  'notes',
  'feel',
  'feels',
  'felt',
  'hope',
  'see',
  'sure',
  'so',
  'such',
  'clear',
  'true',
  'likely',
  'possible',
  'important',
  'argue',
  'argues',
  'claim',
]);
const OPENER =
  /^(more often|at|in|on|by|for|from|with|without|during|throughout|because|although|though|if|when|while|after|before|instead of|despite|unlike|as|since|once|unless|until|whether|even|given|according to|in order to|to)\b/i;
// 常见不规则过去分词（判被动）
const IRREG_PP = new Set([
  'made',
  'done',
  'given',
  'taken',
  'seen',
  'known',
  'shown',
  'written',
  'built',
  'found',
  'held',
  'kept',
  'left',
  'lost',
  'meant',
  'paid',
  'put',
  'read',
  'run',
  'said',
  'sent',
  'set',
  'sold',
  'told',
  'thought',
  'brought',
  'bought',
  'caught',
  'taught',
  'chosen',
  'driven',
  'eaten',
  'fallen',
  'forgotten',
  'gotten',
  'grown',
  'hidden',
  'drawn',
  'broken',
  'spoken',
  'stolen',
  'begun',
  'become',
  'come',
  'understood',
  'met',
  'led',
  'fed',
  'won',
  'lost',
  'heard',
  'felt',
  'left',
  'spent',
  'sent',
  'bound',
  'struck',
]);
const NOT_PP = new Set([
  'need',
  'red',
  'bed',
  'feed',
  'seed',
  'speed',
  'indeed',
  'hundred',
  'interested',
]);

// 字面意思猜不出来的常见短语（每个词都简单，合起来意思变了）。通用表，可以加；不照着具体哪本书挑
export const OPAQUE_PHRASES = [
  'more often than not',
  'up front',
  'by this i mean',
  'by that i mean',
  'on the other hand',
  'in other words',
  'on track',
  'off track',
  'keep in mind',
  'bear in mind',
  'take into account',
  'take for granted',
  'make sense of',
  'come up with',
  'end up',
  'turn out',
  'turns out',
  'turned out',
  'as such',
  'as it were',
  'so to speak',
  'at stake',
  'at hand',
  'at large',
  'by and large',
  'all the same',
  'for good',
  'in vain',
  'in effect',
  'in turn',
  'in kind',
  'on end',
  'over and over',
  'once and for all',
  'to a degree',
  'to some extent',
  'at the expense of',
  'by means of',
  'for the sake of',
  'in the face of',
  'in light of',
  'in terms of',
  'on behalf of',
  'with respect to',
  'as opposed to',
  'let alone',
  'not to mention',
  'all but',
  'anything but',
  'nothing but',
  'none other than',
  'no longer',
  'no sooner',
  'at best',
  'at worst',
  'at most',
  'at least',
  'had better',
  'would rather',
  'might as well',
  'may as well',
  'get at',
  'get across',
  'get by',
  'go about',
  'go without',
  'live up to',
  'stand out',
  'stand for',
  'boil down to',
  'come down to',
  'figure out',
  'carry out',
  'set out',
  'rule out',
  'play out',
  'make up for',
  'make do',
  'in minute detail',
  'the bottom line',
  'a grain of truth',
  'rule of thumb',
  'inside the head of',
  'inside the heads of',
  'in the long run',
  'in the first place',
  'on the fly',
  'from scratch',
  'up to',
  'it is up to',
];

const PHRASAL_VERB =
  /\b(narrow|think|write|make|act|bring|take|put|set|turn|work|figure|point|carry|pick|rule|leave|cut|break|hold|pull|push|lay|hand|pass|give|play|build|sum|fill|try|wear|wind|weed|sort|map|lay|block|shut|call|back|line)(s|ed|ing)?\s+((the|a|an|this|that|these|those|it|them|him|her|your|his|their|our|its)\s+)([a-z'’-]+\s+){0,3}(up|down|out|off|away|apart|over|back|through)\b/i;

const words = (s: string) => s.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];

/** 一句话的难度。next：下一句（下一句开头是「By this I mean」这类，说明这一句要连着读） */
export const sentenceDifficulty = (raw: string, next = '', usePhrases = true): Difficulty => {
  const s = raw
    .replace(/^[\s•·\-–—*\d.)]+(?=[A-Za-z"“])/, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => {
    if (!n) return;
    score += n;
    reasons.push(`${why} ${n > 0 ? '+' : ''}${n}`);
  };
  const w = words(s);
  const lw = w.map((x) => x.toLowerCase().replace(/’/g, "'"));
  const lower = ` ${lw.join(' ')} `;
  if (w.length <= 6) return { score: 0, reasons: ['太短'] };
  if (!/[.?!"”')\]]$/.test(s) && w.length <= 12) return { score: 0, reasons: ['像标题'] };

  // ---- 长度（括号里的、一串并列的不算），最多 +2 ----
  let len = w.length - words((s.match(/\([^()]*\)/g) ?? []).join(' ')).length;
  const listM = s.match(/(?:[\w'-]+(?: [\w'-]+){0,3}, ){2,}(?:and |or )?[\w'-]+/g) ?? [];
  const listItems = Math.max(0, ...listM.map((x) => x.split(',').length));
  const isList = listItems >= 3;
  if (isList) len -= 2 * Math.max(0, listItems - 1);
  add(len >= 33 ? 2 : len >= 22 ? 1 : 0, '长');

  // ---- 从句：几个、套得紧不紧 ----
  const subAt: number[] = [];
  lw.forEach((t, i) => {
    const nx = lw[i + 1] ?? '';
    const nx2 = lw[i + 2] ?? '';
    const pv = lw[i - 1] ?? '';
    if (/^(which|who|whom|whose|where|whereas|whether|because|although|unless)$/.test(t))
      subAt.push(i);
    else if (/^(when|while|if|though|how|why|what)$/.test(t)) {
      if (i === 0 && s.endsWith('?')) return; // 问句开头的疑问词
      if (t === 'though' && (nx === '' || /,\s*though\s*,/i.test(s))) return; // 插入语 though
      subAt.push(i);
    } else if (/^(before|after|until|since|once)$/.test(t)) {
      // 后面跟的是「主语 + 动词」才算从句（after brainstorming 不算）
      if (PRON.has(nx) || DET.has(nx) || (!/ing$/.test(nx) && /^[a-z]+(s|ed)$/.test(nx2)))
        subAt.push(i);
    } else if (t === 'that') {
      if (PREP.has(pv) || pv === 'like') return;
      if (PRON.has(nx) || DET.has(nx) || AUX.has(nx) || SAY_VERB.has(pv) || pv === 'so')
        subAt.push(i);
    }
  });
  const nSub = subAt.length;
  if (nSub === 1) add(1, '有从句');
  else if (nSub >= 2) {
    let tight = false;
    for (let k = 1; k < subAt.length; k++) {
      const between = lw.slice(subAt[k - 1]!, subAt[k]!).join(' ');
      const gap = subAt[k]! - subAt[k - 1]!;
      const sep = new RegExp(
        `${lw[subAt[k - 1]!]}[^;]*?(, and|, but|, or|;)[^;]*?${lw[subAt[k]!]}`,
      ).test(s.toLowerCase());
      if (gap <= 9 && !sep && !/\b(and|but|or)\b/.test(between)) tight = true;
    }
    add(nSub >= 3 || tight ? 3 : 2, nSub >= 3 ? '三个以上从句' : tight ? '从句套从句' : '两个从句');
  }

  // ---- 介词 + which / whom（from which、none of which）----
  if (
    /\b(in|on|at|from|to|with|by|for|of|through|about|under|without|upon|within|during)\s+(which|whom|whose)\b/i.test(
      s,
    ) ||
    /\b(none|all|some|many|most|both|each|neither|either|half|several)\s+of\s+(which|whom)\b/i.test(
      s,
    )
  )
    add(2, '介词+which');

  // ---- 省略 that 的从句：名词后面直接贴「人称代词 + 动词」（the choices you've offered）----
  const contact =
    /\b(the|a|an|any|every|some|no|this|these|those|each|all)\s+([a-z]+\s+)?([a-z]{3,})\s+(i|you|we|they|he|she|i've|you've|we've|they've|i'd|you'd|we'd|they'd|you're|we're|they're)\s+([a-z'’]+)\b/gi;
  for (const m of s.matchAll(contact)) {
    const noun = m[3]!.toLowerCase();
    const mid = (m[2] ?? '').trim().toLowerCase();
    if (
      /^(more|less|better|worse|sooner|later|further|[a-z]+er)$/.test(mid || noun) &&
      m[1]!.toLowerCase() === 'the'
    )
      continue; // the sooner you…
    if (/ly$/.test(noun) || PREP.has(noun) || AUX.has(noun)) continue;
    if (/^(and|or|but|so|if|as|that|because|when|while|than)$/.test(noun)) continue;
    if (/^(and|or|to|of|in|on)$/.test(m[5]!.toLowerCase())) continue;
    add(2, '省略 that 的从句');
    break;
  }

  // ---- 长主语：第一个谓语来得很晚 ----
  const firstVerb = lw.findIndex((t, i) => i > 0 && MAIN_VERB.has(t));
  const commaEarly = (s.split(',')[0] ?? '').split(' ').length;
  const startsGerund =
    /^[A-Z][a-z]+ing\b/.test(s) &&
    !/^(During|Nothing|Everything|Something|Anything|Thing|King|Spring|Morning|Evening|Bring|Sing)\b/.test(
      s,
    );
  const startsWh = /^(What|Whether|How|Why)\b/.test(s) && !s.endsWith('?');
  if (
    ((startsGerund || startsWh) && firstVerb >= 6 && commaEarly > firstVerb) ||
    (!OPENER.test(s) && firstVerb >= 12 && commaEarly > firstVerb)
  )
    add(2, '主语长、谓语来得晚');

  // ---- 句首长铺垫：开头一大段状语，主语迟迟不出来 ----
  const commas = s.split(',');
  if (OPENER.test(s) && commas.length > 1) {
    const lead = words(commas[0]!).length;
    const lead2 = commas.length > 2 ? lead + words(commas[1]!).length : 0;
    if (
      lead >= 9 ||
      (lead2 && lead2 <= 18 && words(commas[1]!).length >= 2 && !/^\s*(and|or)\b/.test(commas[1]!))
    )
      add(2, '句首铺垫长');
  }

  // ---- 插入语把主干劈开 ----
  let cut = false;
  for (const m of s.matchAll(/,\s*([^,;]{3,90}),\s*([a-z'’]+)/gi)) {
    const inner = m[1]!.trim();
    const after = m[2]!.toLowerCase();
    const n = words(inner).length;
    if (n < 2 || n > 12 || /^(and|or)\b/i.test(inner) || /^(and|or)$/.test(after)) continue;
    if (
      isList &&
      !/^(as|which|who|though|however|for example|for instance|in fact|or)\b/i.test(inner)
    )
      continue;
    if (AUX.has(after) || MAIN_VERB.has(after) || /^[a-z]+(s|ed)$/.test(after)) {
      cut = true;
      break;
    }
  }
  if (
    /,\s*(however|though|for example|for instance|in fact|of course|in other words|on the other hand|ironically|in turn)\s*,/i.test(
      s,
    )
  )
    cut = true;
  if (/\w\s*[—–]\s*\w[^—–]{6,}/.test(s) || /\s-{1,2}\s\w/.test(s)) cut = true;
  if (cut) add(2, '插入语劈开');

  // ---- 特殊句式：倒装、the more…the more、反问、强调句、长问句、比较（最多 +3）----
  let special = 0;
  const sp: string[] = [];
  if (
    /(^|[,;]\s*|\b(and|but)\s+)(never|rarely|seldom|hardly|scarcely|little|nowhere|not only|only (when|if|by|after|then|in)|no sooner)\s+(do|does|did|is|are|was|were|have|has|had|can|could|will|would|should)\b/i.test(
      s,
    ) ||
    (/^(had|were|should)\s+(i|you|he|she|it|we|they|the|a|an|there)\b/i.test(s) && !s.endsWith('?'))
  ) {
    special = 3;
    sp.push('倒装');
  }
  if (
    /\bthe\s+(more|less|fewer|better|worse|sooner|harder|further|greater|higher|lower|earlier|later|[a-z]{3,}er)\b[^.?!]{2,90},\s*the\s+(more|less|fewer|better|worse|sooner|harder|further|greater|higher|lower|earlier|later|[a-z]{3,}er)\b/i.test(
      s,
    )
  ) {
    special = 3;
    sp.push('the 越…the 越…');
  }
  if (/\bwhat\s+(is|was|were)\s+to\s+(keep|stop|prevent)\b/i.test(s)) {
    special = 3;
    sp.push('What is to keep…from');
  }
  if (
    /\bit\s+(is|was)\s+(not\s+)?(?!(clear|important|critical|possible|likely|true|necessary|essential|obvious|easy|hard|difficult|unlikely|vital|good|better|best)\b)[^.?!,]{1,45}\s+(that|who)\b/i.test(
      s,
    )
  ) {
    special = Math.max(special, 2);
    sp.push('强调句');
  }
  if (s.endsWith('?') && w.length >= 12) {
    special = Math.max(special, 2);
    sp.push('长问句');
  }
  if (
    /\bas\s+[a-z]+(\s+(and|or)\s+[a-z]+)?\s+as\b/i.test(s) ||
    /\bnot only\b[^.?!]*\bbut\b/i.test(s) ||
    /\bnot\b[^.?!]{1,50}\bbut\s+(rather|instead)\b/i.test(s)
  ) {
    special = Math.max(special, Math.min(3, special + 1));
    sp.push('比较');
  }
  if (special) add(special, sp.join('、'));

  // ---- 字面意思猜不出的短语、拆开的短语动词（最多 +4）----
  if (usePhrases) {
    let ph = 0;
    const hit: string[] = [];
    for (const p of OPAQUE_PHRASES)
      if (lower.includes(` ${p} `)) {
        ph += 2;
        hit.push(p);
      }
    const pv = s.match(PHRASAL_VERB);
    if (pv) {
      ph += 2;
      hit.push(`${pv[1]}…${pv[pv.length - 1]}`);
    }
    if (ph) add(Math.min(4, ph), `短语（${hit.slice(0, 2).join('、')}）`);
  }

  // ---- 辅助项，各 +1：叠在别的难点上才过线 ----
  if (
    /,\s*([a-z]+ly\s+)?(?!including\b|according\b)[a-z]{4,}ing\b/i.test(s) ||
    /\b(adapted|based|edited|written|entitled|called|named|designed|meant|intended|associated|compared|combined|driven|inspired|followed)\s+(from|on|by|to|for|with|in|as)\b/i.test(
      s,
    )
  )
    add(1, '分词挂在后面');
  let neg = 0;
  if (
    /\b(not|n['’]t|never)\b[^.?!]{1,45}\buntil\b/i.test(s) ||
    /\bfail(s|ed|ing)?\s+to\b/i.test(s) ||
    /\b(hardly|scarcely|barely|anything but|far from)\b/i.test(s) ||
    (lower.match(/ (not|n't|never|no|nothing|none|neither|nor|without) /g) ?? []).length >= 2
  )
    neg = 1;
  if (
    /\b(prevent|keep|stop|prohibit|discourage|hinder)s?\b[^.?!]{1,30}\bfrom\s+[a-z]+ing\b/i.test(
      s,
    ) &&
    !sp.includes('What is to keep…from')
  )
    neg = 2;
  add(neg, '否定绕');
  const preps = lw.map((t) => PREP.has(t));
  let chain = 0;
  let best = 0;
  let sinceLast = 99;
  lw.forEach((t, i) => {
    if (preps[i]) {
      chain = sinceLast <= 4 ? chain + 1 : 1;
      sinceLast = 0;
      best = Math.max(best, chain);
    } else sinceLast++;
    if (t === 'and' || t === 'but') sinceLast = 99;
  });
  const nominal = lw.filter(
    (t) => t.length > 6 && /(tion|sion|ment|ness|ity|ance|ence)s?$/.test(t),
  ).length;
  if (best >= 3 || nominal >= 4) add(1, best >= 3 ? '介词一层套一层' : '抽象名词多');
  const farAnd = lw.findIndex(
    (t, i) =>
      i >= 14 &&
      t === 'and' &&
      (AUX.has(lw[i + 1] ?? '') || lw[i + 1] === 'then') &&
      !/,\s*and\b/i.test(s.slice(0, s.toLowerCase().indexOf(` and ${lw[i + 1]}`) + 5)),
  );
  if (
    farAnd > 0 ||
    /\b(to|from|in|on|with|for|of)\s+and\s+([a-z]+\s+){1,3}(to|from|in|on|with|for|of)\b/i.test(s)
  )
    add(1, '远距离并列');
  // 补的：几处被动连着（两家都漏了 Features will be brainstormed … will be playtested …）
  const passive =
    (
      s.match(
        /\b(is|are|was|were|be|been|being|get|gets|got)\s+([a-z]+ly\s+)?([a-z]+ed|[a-z]+en)\b/gi,
      ) ?? []
    ).filter((m) => {
      const pp = m.split(/\s+/).pop()!.toLowerCase();
      return !NOT_PP.has(pp) && (/ed$/.test(pp) || IRREG_PP.has(pp) || /en$/.test(pp));
    }).length +
    (
      lower.match(
        / (is|are|was|were|be|been|being) (made|done|given|taken|seen|known|shown|built|found|held|kept|set|told|thought|brought) /g,
      ) ?? []
    ).length;
  if (passive >= 2) add(passive >= 3 ? 2 : 1, `${passive} 处被动`);
  // 补的：have had / has had / had had
  if (/\b(have|has|had)\s+had\b/i.test(s)) add(1, 'have had');
  // 补的：下一句接着解释这一句，要连着读
  if (
    /^\s*(by (this|that) (i|we) mean|this means|that means|in other words|that is,|put another way|to put it another way)\b/i.test(
      next,
    )
  )
    add(2, '下一句接着解释它');

  // ---- 平铺并列：长，但只是一串并列、没有套着的从句，扣 1 ----
  if (
    w.length >= 22 &&
    nSub <= 1 &&
    (s.includes(';') ||
      isList ||
      ((s.match(/,\s*(and|but)\s/gi) ?? []).length >= 1 && (s.match(/,/g) ?? []).length >= 2))
  )
    add(-1, '平铺并列');
  return { score: Math.max(0, score), reasons };
};
