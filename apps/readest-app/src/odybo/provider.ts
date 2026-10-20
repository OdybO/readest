// 语境查词：顶替 Readest 的「语境词典」（同一个 id），用我们自己的提示词，答案边出边显示。
// 接入点：services/dictionaries/registry.ts 里 builtinFor 返回这个 provider。
// AI 的地址、密钥、模型用 Readest 设置里的「自定义翻译器（OpenAI 兼容）」，和原来的语境词典一样。
import { getContextTranslator } from '@/services/dictionaries/providers/contextProvider';
import {
  createChatModel,
  loadSDK,
  stripReasoning,
} from '@/services/translators/custom/openaiCompatible';
import type { DictionaryProvider } from '@/services/dictionaries/types';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import { ODYBO_SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { contextFor } from './selection';
import { pickSentence, renderAnswer } from './render';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CACHE = 200;
const cache = new Map<string, string>(); // 同一个词、同一段上下文查过就直接显示

/** 弹窗在查询中会把内容藏起来、没展开时只显示 4 行；我们的查词要边出边显示、整个显示。
 * 接入点：app/reader/components/annotator/DictionaryResultsView.tsx 用这个判断。 */
export const isOdyboStreamingProvider = (id: string) => id === BUILTIN_PROVIDER_IDS.context;

export const odyboContextProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.context,
  kind: 'builtin',
  label: '语境查词',
  async lookup(word, ctx) {
    const translator = getContextTranslator();
    if (!translator) {
      ctx.container.textContent =
        '还没有设置 AI：在设置里添加一个 OpenAI 兼容的自定义翻译器（N1 的地址、密钥、模型）。';
      return { ok: true, headword: word, sourceLabel: '语境查词' };
    }
    const sel = ctx.selection;
    // 整段上下文对不上时（比如在词典里点了另一个词），退回 Readest 自己算的前后文
    const mine = contextFor(word);
    const before = (sel?.before ?? '').trim();
    const context = mine
      ? mine.context
      : [before, word, sel?.after].filter(Boolean).join(' ').trim();
    // 选中处在上下文里的位置：我们的整段算法直接给出；退回 Readest 的前后文时，就在前文后面
    const at = mine ? mine.at : before ? before.length + 1 : 0;
    const prompt = buildUserPrompt(sel?.bookTitle ?? '', word, sel ? context : '');
    const sentence = pickSentence(context, word, at);
    const render = (container: HTMLElement, answer: string, done: boolean) =>
      renderAnswer(container, answer, { word, sentence, done, dark: ctx.isDarkMode });
    const key = `${translator.id}|${translator.model}|${prompt}`;
    const hit = cache.get(key);
    if (hit) {
      render(ctx.container, hit, true);
      return { ok: true, headword: word, sourceLabel: translator.name };
    }

    // 用自己的 AbortController：弹窗关掉时 Readest 会取消请求（同 contextDictionary.ts 的做法）
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
    ctx.signal.addEventListener('abort', abort, { once: true });
    render(ctx.container, '', false);
    let answer = '';
    try {
      const [{ streamText }] = await loadSDK();
      const result = streamText({
        model: await createChatModel(translator),
        system: ODYBO_SYSTEM_PROMPT,
        prompt,
        temperature: translator.temperature ?? 0.2,
        maxRetries: 1,
        abortSignal: controller.signal,
      });
      for await (const piece of result.textStream) {
        if (ctx.signal.aborted) break;
        answer += piece;
        render(ctx.container, stripReasoning(answer), false);
      }
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      answer = stripReasoning(answer);
      render(ctx.container, answer, true);
      if (answer) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
        cache.set(key, answer);
      }
      return { ok: true, headword: word, sourceLabel: translator.name };
    } catch (err) {
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      const p = document.createElement('p');
      p.className = 'text-sm text-error mt-2';
      p.textContent = `查询失败：${err instanceof Error ? err.message : String(err)}`;
      ctx.container.append(p);
      return { ok: true, headword: word, sourceLabel: translator.name };
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', abort);
    }
  },
};
