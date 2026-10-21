// 「书的介绍」：读书之前了解这本书——是什么书、作者、背景、讲什么、读了能得到什么、适合谁、英文难度、怎么读（开发者 10-21 要）。
// 发给 AI 的只有书本信息：书名、作者、出版社、出版时间、分类、简介、目录的章节标题，不发正文。
// 提示词是 prompt.ts 的 BOOK_INTRO_PROMPT（WebDAV 上 odybo/prompts/book_intro.txt 有就用那份）。
// 结果存在预读记录里（kind = 'intro'），跟着预读结果一起同步到 WebDAV；下次打开直接显示，可以重新生成。
// 入口：底部工具栏「语境查词」面板里的「这本书的介绍」（ToolbarButton.tsx）。
import { getContextTranslator } from '@/services/dictionaries/providers/contextProvider';
import {
  createChatModel,
  loadSDK,
  stripReasoning,
} from '@/services/translators/custom/openaiCompatible';
import {
  PREFETCH,
  fingerprint,
  getRecord,
  prefetchKey,
  putRecord,
  type PrefetchRecord,
} from './history';
import { getPrompts, refreshPrompts } from './remotePrompts';

const INTRO_TEXT = '（书的介绍）';

export interface BookInfo {
  title: string;
  author?: string;
  publisher?: string;
  published?: string;
  subject?: string;
  description?: string;
  /** 目录的章节标题（最多 40 条） */
  toc?: string[];
}

const clean = (s?: string) =>
  (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 发给 AI 的那条消息：照测试脚本 book_intro_test.py 的写法 */
export const buildIntroMessage = (b: BookInfo) => {
  const lines = [`书名：${b.title}`, `作者：${b.author || '（未知）'}`];
  const add = (name: string, v?: string) => {
    const t = clean(v);
    if (t) lines.push(`${name}：${t}`);
  };
  add('出版社', b.publisher);
  add('出版时间', b.published);
  add('分类', b.subject);
  add('简介', clean(b.description).slice(0, 800));
  const toc = (b.toc ?? []).map(clean).filter(Boolean).slice(0, 40);
  if (toc.length) lines.push(`目录：\n${toc.join('\n')}`);
  return lines.join('\n');
};

/** 存过的介绍（没有就是 null） */
export const savedIntro = async (book: string) =>
  (await getRecord<PrefetchRecord>(PREFETCH, prefetchKey(book, INTRO_TEXT)))?.answer ?? null;

/** 问 AI 生成介绍，边出边回调 onText，完了存下来。返回整段答案；出错抛出。 */
export const makeIntro = async (
  book: string,
  info: BookInfo,
  onText: (text: string) => void,
  signal: AbortSignal,
) => {
  const translator = getContextTranslator();
  if (!translator)
    throw new Error(
      '还没有设置 AI：在设置里添加一个 OpenAI 兼容的自定义翻译器（N1 的地址、密钥、模型）',
    );
  void refreshPrompts();
  const system = getPrompts().bookIntro;
  const [{ streamText }] = await loadSDK();
  const result = streamText({
    model: await createChatModel(translator),
    system,
    prompt: buildIntroMessage(info),
    temperature: 0.3,
    maxRetries: 1,
    abortSignal: signal,
  });
  let answer = '';
  for await (const piece of result.textStream) {
    answer += piece;
    onText(stripReasoning(answer));
  }
  answer = stripReasoning(answer);
  if (answer) {
    const rec: PrefetchRecord = {
      key: prefetchKey(book, INTRO_TEXT),
      book,
      text: INTRO_TEXT,
      kind: 'intro',
      sentence: '',
      para: '',
      answer,
      model: translator.model ?? '',
      promptVersion: fingerprint(system),
      createdAt: Date.now(),
    };
    await putRecord(PREFETCH, rec);
  }
  return answer;
};
