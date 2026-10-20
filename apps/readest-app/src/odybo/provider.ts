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
import { findHistory, fingerprint, historyKey, saveHistory } from './history';
import { getSettings } from './settings';
import { deleteVocab, ignoreVocab, isVocab, lemmaOf } from './vocab';
import {
  findPrefetched,
  findPrefetchedWord,
  isAutoPrefetch,
  rollingPrefetch,
  setAutoPrefetch,
} from './prefetch';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CACHE = 200;
const cache = new Map<string, string>(); // 内存里的一份，省得每次读本机记录
const PROMPT_VERSION = fingerprint(ODYBO_SYSTEM_PROMPT);

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
    const render = (container: HTMLElement, answer: string, done: boolean, note = '') =>
      renderAnswer(container, answer, { word, sentence, done, dark: ctx.isDarkMode, note });
    // 查过没有：同一本书 + 同一个选中的内容 + 同一句（找不到所在句时用整段上下文代替）
    const book = [sel?.bookTitle, sel?.bookAuthor].filter(Boolean).join(' / ');
    const key = historyKey(book, word, sentence || context);
    const rec = await findHistory(key);
    const hit = cache.get(key) ?? rec?.answer;
    // 又查了一次：刷新「最近查询」时间（生词本按它分栏；删掉的生词再查一次也会因此回来）
    if (rec) void saveHistory({ ...rec, createdAt: Date.now() });
    if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
    // 开了「本书自动预读」时，查完（不管是不是本机记录）就从这里往后预读；底部有开关和进度
    const prefetchFrom = () =>
      rollingPrefetch({
        translator,
        book,
        context,
        at,
        selection: word,
        promptVersion: PROMPT_VERSION,
        onProgress: (p) =>
          setStatus(`预读 ${p.done}/${p.total}` + (p.done === p.total ? '，完成' : '…')),
      });
    let statusEl: HTMLElement | null = null;
    const setStatus = (t: string) => {
      if (statusEl) statusEl.textContent = t;
    };
    const footer = (answer: string) => {
      vocabButtons(answer);
      if (!mine) return; // 没有整段上下文时不预读
      const row = document.createElement('label');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: '8px',
        fontSize: '0.75em',
        opacity: '0.75',
      });
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = isAutoPrefetch(book);
      box.disabled = getSettings().prefetchAllBooks; // 设置里开了「所有书」时，这里不能单独关
      box.addEventListener('click', (e) => e.stopPropagation()); // 不让词典卡片把点击当成「展开」
      box.addEventListener('change', () => {
        setAutoPrefetch(book, box.checked);
        if (box.checked) void prefetchFrom();
        else setStatus('');
      });
      statusEl = document.createElement('span');
      row.append(
        box,
        document.createTextNode(
          getSettings().prefetchAllBooks
            ? `所有书自动预读（往后 ${getSettings().prefetchAhead} 截，设置里改）`
            : `本书自动预读（往后 ${getSettings().prefetchAhead} 截）`,
        ),
        statusEl,
      );
      row.addEventListener('click', (e) => e.stopPropagation());
      ctx.container.append(row);
      if (box.checked) void prefetchFrom();
    };
    // 查的是单词或短语：底下两个按钮——移出生词本（再查会回来）、忽略（再查也不进生词本）
    const vocabButtons = (answer: string) => {
      if (!isVocab(word) || !answer) return;
      const lemma = lemmaOf({ word, answer });
      if (!lemma) return;
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        gap: '8px',
        marginTop: '8px',
        fontSize: '0.75em',
      });
      const msg = document.createElement('span');
      msg.style.opacity = '0.7';
      const mk = (label: string, act: () => void, done: string) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost btn-xs';
        b.textContent = label;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          act();
          msg.textContent = done;
          row.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = true));
        });
        return b;
      };
      row.append(
        mk('移出生词本', () => deleteVocab(lemma), `「${lemma}」已移出生词本，再查会回来`),
        mk('忽略', () => ignoreVocab(lemma), `「${lemma}」已忽略，以后不进生词本`),
        msg,
      );
      row.addEventListener('click', (e) => e.stopPropagation());
      ctx.container.append(row);
    };
    // 预读的答案被用上了：也记进「自己查过的」（生词本才会算上这一次）
    const keep = (answer: string) =>
      saveHistory({
        key,
        book,
        word,
        sentence,
        context,
        answer,
        model: translator.model ?? '',
        promptVersion: PROMPT_VERSION,
        source: 'prefetch',
        createdAt: Date.now(),
      });
    if (hit) {
      cache.set(key, hit);
      render(ctx.container, hit, true, '本机记录');
      footer(hit);
      return { ok: true, headword: word, sourceLabel: translator.name };
    }
    // 选中的是预读过的一截或一句（至少 3 个词），或者按生词预读过的「这个词在这一句里」
    const pre =
      (await findPrefetched(book, word)) ?? (await findPrefetchedWord(book, word, sentence));
    if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
    if (pre) {
      cache.set(key, pre.answer);
      void keep(pre.answer);
      render(ctx.container, pre.answer, true, pre.note);
      footer(pre.answer);
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
      footer(answer);
      if (answer) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
        cache.set(key, answer);
        void saveHistory({
          key,
          book,
          word,
          sentence,
          context,
          answer,
          model: translator.model ?? '',
          promptVersion: PROMPT_VERSION,
          source: 'lookup',
          createdAt: Date.now(),
        });
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
