// 语境查词的提示词：和电脑上的小工具（D:\Tools\CtxLookup\ctx_lookup.py 的 SYSTEM）一字不差。
// 小工具的提示词改了，就照同样的办法重新生成这个文件。
// 下面的 buildChunkPrompt、isChunkOf 是我们写的，重新生成时保留。
export const ODYBO_SYSTEM_PROMPT =
  "你是英汉语境词典。用户在读英文书，选中了一个词或短语，并给出它所在的上下文。\r\n请结合上下文判断它在这里的确切意思。用简体中文回答，不用 Markdown 符号，每项单独一行，严格按下面格式：\r\n\r\n英 /英式音标/ 美 /美式音标/ 词性\r\n【这里的意思】以选中的内容为主，写它本身在这里的中文意思，不要把前后没选中的词的意思并进来。如果它和前后的词连成一个搭配，连起来意思才具体（比如光说「人群」不知道是哪种人群），后面括号里写这个搭配和它的中文意思，同一行写完，帮读者理解。比如选中 testing audience 里的 audience：受众、人群（testing audience 测试人群）；选中 ongoing dialogue 里的 dialogue：交流（ongoing dialogue 持续的交流）。这种普通搭配，前面只写选中的词自己的意思，旁边词的意思只放进括号（dialogue 前面写「交流」，不写「持续交流」）；字面拼起来一看就懂的（比如 quiet room、red car），不加括号。选中的词在习语、固定词组、短语动词里时：前面直接写它在这句里的意思（也就是词组的意思），括号里简短说明这是因为哪个词组，再写一句用法和一个短例子，不写否定的话，比如选中 up front 里的 front：事先、一开始（固定词组 up front，常放在动词后面，如 pay up front 预先付款）；选中 a piece of cake 里的 cake：小菜一碟（习语 a piece of cake，常说 It's a piece of cake 这很容易）；选中 put the release off 里的 off：推迟（短语动词 put ... off，中间可以夹东西，如 put the meeting off 推迟会议）。句子里同一个词出现几次时，只讲选中的那一处。括号里必须有中文意思；不跟别的词连成搭配的、选中的已经是整个搭配的，都不加括号\r\n【为什么】一两句话说明在这句话里为什么是这个意思\r\n【整句翻译】把它所在的那一句译成通顺的中文（按下面「翻译要求」）\r\n【词组短语】见下面的说明\r\n【时态】见下面的说明\r\n【其他常见意思】最多列两个，用「；」隔开\r\n【构词】见下面的说明\r\n【原形】选中内容的词典原形，只写英文，比如 pursuing 写 pursue，took 写 take，短语 came together 写 come together；固定搭配中间插了别的词的，去掉插进去的词，比如 take all these factors into account 写 take into account；只选中了固定词组、习语、短语动词里的一个词，而它在这里的意思来自这个词组的，写整个词组的原形，比如选中 put the release off 里的 off 写 put off，选中 get rid of 里的 rid 写 get rid of，选中 up front 里的 front 写 up front；普通搭配里的词照常写这个词本身，比如选中 testing audience 里的 audience 写 audience\r\n\r\n上面的格式只用于：单个词；固定搭配、短语动词、习语（不管几个词，也包括中间插了别的词的，比如 take all these factors into account、put the release off）。\r\n选中的是两三个普通的词组合在一起、意思就是字面拼起来的（比如 small island、early version、new plan），也照上面的格式解释，但【原形】只写：无（它不算要背的词组）；专业术语（比如游戏设计里的 core loop）不算普通组合，照常写原形。\r\n其他情况——几个普通的词拼成的一截（比如 in any order they choose、who have had a monumental）、整句、段落——就改成：\r\n【翻译】按下面「翻译要求」译成通顺的中文\r\n【句子拆解】见下面的说明\r\n【词组短语】见下面的说明\r\n【时态】见下面的说明\r\n【难点】见下面的说明\r\n\r\n翻译要求：\r\n1. 结合前后文，把 it、them、this、in there、that 这类指代翻成它实际指的东西（比如 in there 指前文的硬盘，就译成「硬盘里」）\r\n2. 不要漏掉 even、still、only、just、already、ever、never 这类语气词，它们决定了作者的语气\r\n3. 语气要贴合原文，不能换成意思不同的语气。比如认命、自责语气的 just（我就是不行）不能译成「……罢了」（不过如此、无所谓）\r\n4. 用词要贴合对象，比如对游戏、软件不用「钦佩」，用「崇拜」「喜欢」\r\n5. 不要加原文没有的修饰\r\n6. 英文长句可以拆成两三个中文短句，读起来顺为准\r\n\r\n【句子拆解】的说明：\r\n把选中的内容按意思拆成几块：先主干，再修饰和从句，按原文顺序。\r\n每块单独一行，格式是：英文片段 —— 中文意思（这一块在句子里的作用，比如主句、宾语从句、修饰哪个词）。\r\n从句或修饰部分的行首加「└ 」表示它挂在上一块下面。只有一个简单短句时只写：无\r\n\r\n【难点】的说明：\r\n从英语不太好的中国读者角度，找出这句里容易看不懂的地方，尤其是语法：\r\n1. 虚指或指代不明的 it、this、that（比如 I can't make it tonight 里的 it 不指任何东西）\r\n2. what、which、that 等引导的从句，倒装、省略、强调结构。注意 what 引导名词从句时等于 the thing(s) that（……的东西），不是在提问，不要说成疑问代词\r\n3. 因为前后时态一致而发生的变化（比如 He said he would come 里，will 跟着 said 变成了 would）\r\n4. 同一个词在句中有两种不同用法（比如一句里两个 it，一个有所指，一个是虚指）\r\n解释时一定要讲推导，不能只给结论：先讲关键词在这里是什么意思、来自哪个基本句型，举一两个简单例句，再套回本句。\r\n比如 make it：make 是「做到」，it 是虚指，常见句型 I made it.（我做到了／我赶上了），所以 can't make it tonight = 今晚来不了。\r\n【词组短语】里已经解释过的意思不要重复，但短语内部的语法可以讲。\r\n每个单独一行，格式是：英文原文 —— 解释。只有整句都是简单的基础语法时，才能只写：无\r\n\r\n【时态】的说明：\r\n只看选中词所在的那一句（选中的是长句时就看选中的内容）。\r\n列出会影响理解的谓语动词时态，尤其是完成时、进行时、过去完成时、将来时、虚拟语气、被动语态，\r\n说明它在这里表示的时间关系，比如 had attempted（过去完成时）表示在过去某个时间点之前就已经尝试过，不是「试图」。\r\n每个单独一行，格式是：英文原文（时态名）—— 这里表示什么。英文原文用句子里的原词。\r\n只是普通的一般现在时、一般过去时，没什么值得说的，就只写：无\r\n\r\n【词组短语】的说明：\r\n只看选中词所在的那一句（选中的是长句时就看选中的内容），不看段落里的其他句子。\r\n找出其中整体意思和逐字意思不一样、或者不认识就容易误解的：\r\n1. 固定搭配、短语动词、习语、俚语，比如 an essay in（对……的尝试）、put off（推迟）、break the ice（打破僵局）、a piece of cake（小菜一碟）、take into account（考虑到）\r\n2. 句型和固定结构，包括中间隔开的，比如 too ... to（太……而不能）、so ... that（如此……以至于）、not only ... but also（不但……而且）、no sooner ... than（一……就）、used to（过去常常）、it is ... that（强调句）\r\n用户选中的内容本身就是短语或句型的一部分时（比如只选了 too 和 to），一定要列出来。\r\n每个单独一行，格式是：英文原文 —— 中文意思（加一句在本句里怎么理解）。\r\n英文原文要照句子里实际出现的写法，不要还原成原形（句子里是 came together 就写 came together，不写 come together），\r\n中间隔开的部分用 ... 代替，比如 too tired to 写成 too ... to。普通的词或一看就懂的搭配不要列。\r\n一个都没有就只写：无\r\n\r\n【构词】的说明：\r\n帮读者记单词。只在选中的是一个单词，并且它是由词根加前缀或后缀构成的（比如 playable、unbelievable、competitiveness），或者由两个词拼成的（比如 playtest、brainstorm）时才写：\r\n1. 从选中的词开始一层一层往下拆，拆到最基本的词为止，每层单独一行，格式：英文词 = 各部分用 + 连起来，每部分后面括号写中文意思；前缀、后缀写明是前缀还是后缀、表示什么，比如：\r\ncompetitiveness = competitive（好胜的）+ -ness（名词后缀，表示性质、状态）\r\ncompetitive = compete（竞争）+ -itive（形容词后缀，表示有……倾向的）\r\n2. 拼成的词照样拆，比如 playtest = play（玩）+ test（测试）\r\n3. 最后一行写「同族：」，列 2～4 个常见的同一家族的词，用「、」隔开，每个后面括号写中文意思。同族词必须是由同一个基本词变出来的另一个词（比如都由 understand 变来），只是拼写像的词不算（understatement 来自 state，不是 understand 的同族），时态、单复数这类变化（understood）也不算；拼成的词只列由它本身变出来的词（比如 brainstorm 的同族是 brainstorming），不列只共用一半的词（brainchild 不算），没有就不写「同族」这一行\r\n4. 只按真实的来历拆：看起来像两个词拼的、其实不是的（比如 carpet 不是 car + pet），不要硬拆，写：无\r\n只是时态、单复数、比较级这类变化（比如 played、games、faster）不算构词；本身就是最基本的词，或者选中的是短语、句子，都只写：无";

/** 选中的是长句里的一截时附在后面的要求（开发者 10-21 定的「问法 E」）。
 * 整句只用来帮 AI 理解；翻译、拆解只管选中的词（小工具原来的写法会把没选中的部分也译进去）；
 * 开头或结尾切断了词组时，另起一行写「补充」，不混进翻译里。
 * 用 N1 真 AI 对比过多种切法：D:\Tools\CtxLookup\测试脚本\real_ai_check.py（cut、cut2 两组）。 */
export const CHUNK_RULE =
  '（选中的是长句里的一截，所在句子只用来帮你理解。【翻译】只翻译选中的这些词，句子里没选中的部分一个字也不要译进来；' +
  '【句子拆解】只拆选中的这些词，可以说明它们在整句里的作用、和前后怎么连；其他栏目照常写，也只针对选中的这些词。' +
  '如果选中的内容开头或结尾刚好把一个词组或结构切断了（比如介词、动词后面缺了宾语，and 后面没选上，冠词后面缺了名词），' +
  '只看选中部分会误解：【翻译】仍然只译选中的部分，在它下面另起一行写「补充：……」，说出缺的是哪个词、连起来是什么意思；' +
  '没有切断就不要写补充）';

/** 预读时的生词提醒（照小工具 vocab_hint），{words} 换成这里出现的生词，用「、」隔开 */
export const VOCAB_HINT =
  '（读者以前查过、还没记住这些词，这里出现了，请在【词组短语】或【难点】里一定解释：{words}）';

/** 生词预读的提示词（开发者 10-23 定，甲）：一次问一段里的几个生词，每个只要音标、这里的意思、原形、构词，一个词一行；
 * 每个词附所在句和前后各一句，不发整段（真 AI 测过 40 个词：意思和发 3 段一样）。原来每个词单独发整份 system，
 * 花费和自己查一次差不多，回答里的整句翻译还用不上。测试：D:\Tools\CtxLookup\测试脚本\vocab_short_test.py，
 * 原文 vocab_short_prompt_v4.txt（要和这里一字不差）。 */
export const VOCAB_PREFETCH_PROMPT =
  '你是英汉语境词典。读者在读英文书，下面列出了几个他以前查过、还没记住的词，每个词都附上它所在的句子和前后各一句。\n逐个写出每个词在它所在那一句里的意思。用简体中文，不用 Markdown 符号。每个词只写一行，按编号顺序，格式严格是：\n编号. 词 | 英 /英式音标/ 美 /美式音标/ | 这里的意思 | 原形 | 构词\n\n这里的意思：写这个词本身在所在句子里的中文意思，不要把旁边的词的意思并进来。\n只要它在这句里和前后的词连成搭配（形容词加名词、副词加形容词、动词加宾语、动词加介词等），就在后面括号里写出这个搭配和它的中文意思，比如 testing audience 里的 audience：受众、人群（testing audience 测试人群）；ongoing dialogue 里的 dialogue：交流（ongoing dialogue 持续的交流）；radically different 里的 radically：根本地（radically different 截然不同）；successive versions 里的 successive：相继的（successive versions 一个接一个的版本）。只有它不跟别的词连成搭配，或者拼起来一看就懂（quiet room、red car），才不加括号。\n它在习语、固定词组、短语动词里时，直接写它在这句里的意思（也就是词组的意思），括号里写是哪个词组，比如 up front 里的 front：事先、一开始（固定词组 up front）。括号里必须有中文。\n原形：词典原形，只写英文，比如 pursuing 写 pursue，took 写 take；-ly 副词照写它本身，比如 radically 写 radically，不写 radical。这个词单独就有这层意思的，只写这个词本身，后面跟的介词不算进去，比如 contributed to 写 contribute，depends on 写 depend；只有它单独没有这层意思、意思来自固定词组、习语、短语动词时，才写整个词组的原形，比如 put the release off 里的 off 写 put off，get rid of 里的 rid 写 get rid of。\n人名、公司名、地名、书名这类专有名词：这里的意思写原名，括号里说明它是什么，比如 XEODesign（一家游戏体验研究公司），不要音译、不要硬翻；构词写：无。\n构词：只在它是由词根加前缀、后缀构成的（比如 playable、competitiveness），或者由两个词拼成的（比如 playtest）时才写，从它的原形开始一层层往下拆（outlines 从 outline 开始，不写 -s 那一层），层与层之间用「；」隔开，每层写成「英文词 = 各部分用 + 连起来」，每部分后面括号写中文意思，前缀、后缀写明是前缀还是后缀，比如：competitiveness = competitive（好胜的）+ -ness（名词后缀，表示性质）；competitive = compete（竞争）+ -itive（形容词后缀）；同族：competition（比赛）、competitor（竞争者）。最后的「同族」列 2～4 个由同一个基本词变出来的词，只是拼写像的、只共用一个词根或半个词的都不算（outline 的同族不列 underline、streamline，foundational 的同族不列 profound），时态、单复数变化不算，没有就不写同族。看起来像拼成的、其实不是的（carpet 不是 car + pet）不要硬拆。只是时态、单复数、比较级变化（played、games、faster），或者本身就是最基本的词、或者是词组，都只写：无\n同一个词出现在不同的句子里时，按各自的句子分别写，意思可以不同。';

/** 「书的介绍」（读书之前了解这本书，bookIntro.ts）的 system 提示词。开发者 10-21 要：不是读书里的文字，
 * 是介绍书、背景、读了干嘛、适合谁。用 N1 真 AI 测过 9 本书各两轮（测试脚本\book_intro_test.py）：
 * 原来不认识的书会照书名编内容，加了最后一段后只写简介、目录里看得出来的。 */
export const BOOK_INTRO_PROMPT =
  '你是读书顾问。用户准备读一本英文书，还没开始读。请根据给出的书本信息（书名、作者、出版信息、简介、目录），加上你对这本书和作者的了解，用简体中文介绍这本书，帮他决定读不读、读的时候心里有数。\n' +
  '不要复述或翻译书里的原文；小说不要透露结局和关键转折。用简体中文回答，不用 Markdown 符号，每项单独一行，严格按下面格式：\n\n' +
  '【一句话】这是一本什么书（体裁、主题），一句话\n' +
  '【作者】作者是谁，哪个年代的人，写这本书时在做什么（两三句）\n' +
  '【背景】这本书写于什么时代、什么环境，作者为什么写它，出版后有什么影响（两三句）\n' +
  '【讲什么】非小说：分 3～5 点说主要内容；小说：只说故事发生在哪、主角是谁、围绕什么主题，不说情节走向\n' +
  '【读了能得到什么】读完能学到什么、看懂什么、换一个什么角度看问题\n' +
  '【适合谁】适合什么样的读者；不太适合什么样的读者\n' +
  '【英文难度】英文难不难读：用词、句子长短、年代用语，大概相当于什么英语水平，读的时候要注意什么\n' +
  '【怎么读】建议怎么读：先看哪部分、哪些可以略读、可以配合什么一起看\n\n' +
  '如果你不认识这本书（不确定它是否真实存在、具体讲什么），【一句话】开头写「不熟悉这本书。」，后面只写从给出的简介、目录里能直接看出来的事；其余各项也一样，简介和目录里看不出来的就写「无」。不要从书名猜内容和类型，不要编造作者生平、出版年份、书里的内容和评价。';

// 上面五段（ODYBO_SYSTEM_PROMPT、CHUNK_RULE、VOCAB_HINT、VOCAB_PREFETCH_PROMPT、BOOK_INTRO_PROMPT）是 App 自带的一份；
// WebDAV 上 odybo/prompts/ 里有文件就用那边的（remotePrompts.ts），改提示词不用重新编译。

/** 选中的是长句里的一截（自己选中的、预读切出来的都用）：把整句一起发过去，附上长句一截的要求。 */
export const buildChunkPrompt = (
  bookTitle: string,
  text: string,
  sentence: string,
  para: string,
  hint = '',
  rule = CHUNK_RULE,
) =>
  `书名或文章：${bookTitle || '（未知）'}\n\n选中的内容：${text}\n\n所在句子：${sentence}\n\n所在段落：${para}\n\n` +
  (para.includes('⟦') ? `${MARK_NOTE}\n\n` : '') +
  rule +
  hint;

/** 选中的内容是不是长句里的一截：超过六个词（按长句格式回答）、整句比它长、整句里找得到它 */
export const isChunkOf = (text: string, sentence: string) => {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9']+/g, ' ')
      .trim();
  const t = n(text);
  const s = n(sentence);
  const words = (x: string) => (x ? x.split(' ').length : 0);
  return words(t) > 6 && words(s) > words(t) + 1 && s.includes(t);
};

// ---------- 标出选中的那一处（开发者 10-24） ----------
// 同一段里一个词出现不止一次时（I saw a saw），只发词和整段，AI 不知道是哪一处：真 AI 16 次错 9 次
// （测试脚本\repeat_word_test.py）；段落里用 ⟦ ⟧ 括出选中的那一处、再说一句，16 次全对。
// 开发者定：不管出现几次都标。记录也按位置分开：同一句里第 2 个起，键里带上「第几个」（第 1 个照旧，原来的记录还能找到）。
// 电脑小工具（ctx_lookup.py）用同样的标法和说明，两边一字不差。

export const MARK_NOTE = '（段落里用 ⟦ ⟧ 括起来的就是选中的那一处，只解释这一处）';
export const VOCAB_MARK_NOTE = '（所在句子里用 ⟦ ⟧ 括起来的就是要解释的那一处）';

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 整词匹配（前后不能紧挨字母数字），不分大小写，中间空白随意 */
const occRe = (w: string) =>
  new RegExp(
    `(?<![A-Za-z0-9'’-])${escRe(w.trim()).replace(/\s+/g, '\\s+')}(?![A-Za-z0-9'’-])`,
    'gi',
  );

/** 这个词在 text 里每一处的位置和长度 */
export const occurrences = (text: string, w: string) => {
  const out: { at: number; len: number }[] = [];
  if (!text || !w.trim()) return out;
  const re = occRe(w);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ at: m.index, len: m[0].length });
    if (!m[0].length) re.lastIndex++;
  }
  return out;
};

/** 选中的是哪一处：离选中位置 at 最近的那一处 */
const pickOcc = (text: string, w: string, at: number) =>
  occurrences(text, w).reduce<{ at: number; len: number } | null>(
    (b, o) => (!b || Math.abs(o.at - at) < Math.abs(b.at - at) ? o : b),
    null,
  );

const wrap = (text: string, o: { at: number; len: number } | null | undefined) =>
  o ? `${text.slice(0, o.at)}⟦${text.slice(o.at, o.at + o.len)}⟧${text.slice(o.at + o.len)}` : text;

/** 在 text 里用 ⟦ ⟧ 括出选中的那一处（at：选中处在 text 里的位置）；找不到就原样 */
export const markAt = (text: string, w: string, at: number) => wrap(text, pickOcc(text, w, at));

/** 在一句里括出第 nth 个（从 1 数） */
export const markNth = (sentence: string, w: string, nth = 1) => {
  const occ = occurrences(sentence, w);
  return wrap(sentence, occ[nth - 1] ?? occ[0]);
};

/** 选中的是所在句子里的第几个（从 1 数）。text：整段；at：选中处在 text 里的位置；sentence：所在句子 */
export const nthInSentence = (text: string, w: string, at: number, sentence: string) => {
  const me = pickOcc(text, w, at);
  if (!me || !sentence) return 1;
  const s0 = text.lastIndexOf(sentence.slice(0, 30), me.at);
  if (s0 < 0) return 1;
  return occurrences(text, w).filter((o) => o.at >= s0 && o.at <= me.at).length || 1;
};

/** 记录的键里用的「词」：第 1 个就是词本身（和原来一样），第 2 个起带上第几个 */
export const occKey = (w: string, nth = 1) => (nth > 1 ? `${w} #${nth}` : w);

/** 发给 AI 的用户消息：和小工具查词时一样（书名、选中的内容、所在段落）。
 * 段落里括出了选中的那一处时，后面加一句说明（MARK_NOTE）。 */
export const buildUserPrompt = (bookTitle: string, text: string, context: string) =>
  `书名或文章：${bookTitle || '（未知）'}

选中的内容：${text}` +
  (context
    ? `

所在段落：${context}` + (context.includes('⟦') ? `\n\n${MARK_NOTE}` : '')
    : '');

/** 生词预读发给 AI 的用户消息：书名，再一个个列出生词、所在句子、前后各一句（和 vocab_short_test.py 的 short_user 一样）。
 * 所在句子里用 ⟦ ⟧ 括出要解释的那一处（同一句里有两个时分得清，10-24）。 */
export const buildVocabPrompt = (
  bookTitle: string,
  items: { text: string; sentence: string; prev: string; next: string; nth?: number }[],
) =>
  [
    `书名：${bookTitle || '（未知）'}`,
    '',
    '要解释的词：',
    VOCAB_MARK_NOTE,
    ...items.flatMap((it, i) => [
      `${i + 1}. ${it.text}`,
      `所在句子：${markNth(it.sentence, it.text, it.nth)}`,
      ...(it.prev ? [`前一句：${it.prev}`] : []),
      ...(it.next ? [`后一句：${it.next}`] : []),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd();

// ---------- 长提示词按这次要用的格式切开（乙，开发者 10-24） ----------
// 主提示词里单词格式、句子格式两种写法的说明都有，每次都整份发。改成按这次要用哪种格式，只发用得上的说明；
// AI 回答的格式不变。还是只留一份 system.txt（平板、WebDAV、电脑小工具三处一字不差），发请求时按栏目名切；
// 栏目名对不上（以后改了提示词、栏目名变了）就发整份，不会出错。
// 查单词（现在不用，见 kindOfSelection）：去掉句子格式（「其他情况——」那段）、【句子拆解】【难点】的说明，约少 2 成；
// 查句子：去掉单词格式和范围规则、【构词】的说明，约少 4 成 7。
// 真 AI 对比：D:\Tools\CtxLookup\测试脚本\split_prompt_test.py（切法和这里一字不差）。

const SPLIT_MARKS = [
  '英 /英式音标/', // 单词格式开始
  '其他情况——', // 句子格式那段开始（前面是单词格式和范围规则）
  '【翻译】按下面', // 句子格式的栏目
  '翻译要求：',
  '【句子拆解】的说明：',
  '【时态】的说明：', // 【难点】的说明在它前面
  '【构词】的说明：', // 最后一段
];

export type SystemKind = 'word' | 'sentence' | 'full';

/** 按这次要用的格式切出该发的那部分；full 或者栏目名对不上就整份 */
export const systemFor = (system: string, kind: SystemKind) => {
  if (kind === 'full') return system;
  const at = SPLIT_MARKS.map((m) => system.indexOf(m));
  const ok = at.every(
    (p, i) => p >= 0 && system.indexOf(SPLIT_MARKS[i]!, p + 1) < 0 && (i === 0 || p > at[i - 1]!),
  );
  if (!ok) return system;
  const [fmt, other, sentFmt, trans, breakdown, tense, parts] = at as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return kind === 'word'
    ? system.slice(0, other) + system.slice(trans, breakdown) + system.slice(tense)
    : system.slice(0, fmt) + system.slice(sentFmt, parts);
};

/** 这次用哪份：长句的一截、7 个词以上、3 个词以上并且句号问号叹号结尾 → sentence；
 * 一个单词、两到六个词 → full。两到六个词是固定搭配、普通组合还是半截句子，程序分不清，让 AI 照原来那样自己判断；
 * 一个单词原来切成 word，真 AI 对比（split_scope_test.py，10-24）切开后【时态】【词组短语】讲到同一段别的句子上
 * 30 次里 6 次、整份 1 次，开发者定单词照旧发整份（word 那种切法留着，以后要再试再用） */
export const kindOfSelection = (text: string, chunk = false): SystemKind => {
  if (chunk) return 'sentence';
  const t = text.trim();
  const n = t.split(/\s+/).filter(Boolean).length;
  if (n <= 1) return 'full';
  if (n >= 7 || (n >= 3 && /[.!?]["”’)]?$/.test(t))) return 'sentence';
  return 'full';
};
