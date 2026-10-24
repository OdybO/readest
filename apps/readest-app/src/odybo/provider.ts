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
import {
  buildChunkPrompt,
  buildUserPrompt,
  isChunkOf,
  kindOfSelection,
  markAt,
  nthInSentence,
  occKey,
  systemFor,
} from './prompt';
import { getPrompts, refreshPrompts } from './remotePrompts';
import { syncSoon } from './dataSync';
import { contextFor } from './selection';
import { pickSentence, renderAnswer } from './render';
import {
  HISTORY,
  PREFETCH,
  deleteRecord,
  findHistory,
  fingerprint,
  getRecord,
  historyKey,
  prefetchKey,
  saveHistory,
} from './history';
import { getSettings } from './settings';
import { remarkOpenDocs } from './marks';
import {
  deleteVocab,
  ignoreVocab,
  isIgnored,
  isVocab,
  lemmaOf,
  undeleteVocab,
  unignoreVocab,
} from './vocab';
import { openVocabBook } from './vocabLink';
import {
  findPrefetched,
  findPrefetchedWord,
  isAutoPrefetch,
  isShortAnswer,
  rollingPrefetch,
  setAutoPrefetch,
} from './prefetch';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CACHE = 200;
const cache = new Map<string, string>(); // 内存里的一份，省得每次读本机记录

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
    // 提示词：WebDAV 上有就用那边的（remotePrompts.ts）；这次用手上的那份，顺便在后台看看有没有更新
    void refreshPrompts();
    syncSoon(); // 我们的数据和 WebDAV 同步（最多 10 分钟一次，dataSync.ts）
    const prompts = getPrompts();
    const PROMPT_VERSION = fingerprint(prompts.system);
    const sel = ctx.selection;
    // 整段上下文对不上时（比如在词典里点了另一个词），退回 Readest 自己算的前后文
    const mine = contextFor(word);
    // 点单词透镜的小字查的：记成 lens（只是记一下来源；10-21 起透镜查的也进生词本）
    const lensSource = mine?.fromLens ? ('lens' as const) : undefined;
    const before = (sel?.before ?? '').trim();
    const context = mine
      ? mine.context
      : [before, word, sel?.after].filter(Boolean).join(' ').trim();
    // 选中处在上下文里的位置：我们的整段算法直接给出；退回 Readest 的前后文时，就在前文后面
    const at = mine ? mine.at : before ? before.length + 1 : 0;
    const sentence = pickSentence(context, word, at);
    // 选中的是所在句里的第几个，段落里用 ⟦ ⟧ 括出选中的那一处（10-24：同一个词出现不止一次时 AI 分不清是哪一处）
    const nth = nthInSentence(context, word, at, sentence);
    const marked = markAt(context, word, at);
    // 选中的是长句里的一截：照小工具，把整句一起发过去，只翻译这一截
    const chunk = !!(sel && sentence && isChunkOf(word, sentence));
    const prompt = chunk
      ? buildChunkPrompt(sel?.bookTitle ?? '', word, sentence, marked, '', prompts.chunk)
      : buildUserPrompt(sel?.bookTitle ?? '', word, sel ? marked : '');
    // 只发这次要用的那种格式的说明（乙，10-24）：一个单词 / 句子、长句的一截 / 两到六个词发整份
    const system = systemFor(prompts.system, kindOfSelection(word, chunk));
    // 答案出完才在音标那行右边放「删除」（查词中途不放）
    const render = (container: HTMLElement, answer: string, done: boolean, note = '') =>
      renderAnswer(container, answer, {
        word,
        sentence,
        done,
        dark: ctx.isDarkMode,
        note,
        action: done && answer ? deleteButton() : undefined,
      });
    // 查过没有：同一本书 + 同一个选中的内容 + 同一句（找不到所在句时用整段上下文代替）+ 句里第几个（第 2 个起才带）
    const book = [sel?.bookTitle, sel?.bookAuthor].filter(Boolean).join(' / ');
    const key = historyKey(book, occKey(word, nth), sentence || context);
    const rec = await findHistory(key);
    const hit = cache.get(key) ?? rec?.answer;
    let saving: Promise<unknown> = Promise.resolve(); // 正在存的这次记录：删除要等它存完再删
    // 「删除」：误点查出来的留着没用（开发者 10-23）。要点两次。删掉这次的记录（这一次如果用的是预读的答案，
    // 那条预读也删，下次再选同一处会重新问 AI），书里这一处的标注拆掉，关掉卡片；删除会同步给别的设备（history.ts）
    const deleteButton = () => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-xs btn-ghost text-error shrink-0';
      btn.textContent = '删除';
      let armed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!armed) {
          armed = true;
          btn.textContent = '再点一次删除';
          // 红底时去掉红字（text-error），用按钮自带的白字，不然红底红字看不清（开发者 10-23）
          btn.classList.replace('btn-ghost', 'btn-error');
          btn.classList.remove('text-error');
          timer = setTimeout(() => {
            armed = false;
            btn.textContent = '删除';
            btn.classList.replace('btn-error', 'btn-ghost');
            btn.classList.add('text-error');
          }, 3000);
          return;
        }
        if (timer) clearTimeout(timer);
        btn.disabled = true;
        await saving;
        await deleteRecord(HISTORY, key);
        cache.delete(key);
        for (const pk of [
          prefetchKey(book, word),
          prefetchKey(book, `${occKey(word, nth)} | ${sentence}`),
        ])
          if (await getRecord(PREFETCH, pk)) await deleteRecord(PREFETCH, pk);
        remarkOpenDocs(book);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      return btn;
    };
    // 又查了一次：刷新「最近查询」时间（生词本按它分栏；删掉的生词再查一次也会因此回来）
    // 自己选中再查一次：原来是点透镜查的那条也改记成自己查的（这样才进生词本）
    // 点透镜又查一次：原来已经算自己查的（或点过「加入生词本」）就保持，不降回透镜
    if (rec)
      saving = saveHistory({
        ...rec,
        createdAt: Date.now(),
        source: rec.source === 'lens' ? (lensSource ?? 'lookup') : rec.source,
      }).then(() => remarkOpenDocs(book)); // 透镜那条改成自己查的：书里补标
    if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
    // 查完（不管是不是本机记录）就从这里往后预读：开了「本书句子预读」预读句子，开着「生词预读」预读生词
    // （两个开关分开，10-23）；底部有句子预读的开关和进度
    const prefetchFrom = () =>
      rollingPrefetch({
        translator,
        book,
        context,
        at,
        selection: word,
        selectedSentence: sentence,
        selectedNth: nth,
        promptVersion: PROMPT_VERSION,
        ahead: mine?.ahead,
        onProgress: (p) => {
          // 句子、生词分开数，哪样没做就不写（开发者 10-23：只预读生词时原来显示在句子预读那一行，像句子在跑）
          // 生词：这次补了几个 / 往后已经备好几个（没到补货线就不问，只显示备好的）
          const parts = [
            p.sentTotal ? `句子 ${p.sentDone}/${p.sentTotal}` : '',
            p.wordTotal
              ? `生词 ${p.wordDone}/${p.wordTotal}` +
                (p.wordReady ? `（往后已备 ${p.wordReady} 个）` : '')
              : p.wordReady
                ? `生词往后已备 ${p.wordReady} 个`
                : '',
          ].filter(Boolean);
          const done = p.sentDone === p.sentTotal && p.wordDone === p.wordTotal;
          setStatus(parts.length ? `预读：${parts.join(' · ')}${done ? '，完成' : '…'}` : '');
        },
      });
    let statusEl: HTMLElement | null = null;
    const setStatus = (t: string) => {
      if (statusEl) statusEl.textContent = t;
    };
    // 先存好这次的查词记录，再往后预读（开发者 10-23）：不然刚查的词还不在生词本里，
    // 书里后面它出现的地方这一轮找不到，要等下次查词才补。卡片底部画好时只记下要预读，存完由 kickPrefetch 开始
    let pendingPrefetch = false;
    const kickPrefetch = () => {
      if (!pendingPrefetch) return;
      pendingPrefetch = false;
      void saving.then(() => prefetchFrom());
    };
    // 答案下面画一条分隔线，下面是可操作的部分：生词按钮、本书句子预读
    const footer = (answer: string) => {
      const section = document.createElement('div');
      Object.assign(section.style, {
        borderTop: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        marginTop: '12px',
        paddingTop: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        fontSize: '0.8em',
      });
      section.addEventListener('click', (e) => e.stopPropagation()); // 不让词典卡片把点击当成「展开」
      if (isShortAnswer(answer)) fullButton(section);
      vocabButtons(section, answer);
      if (mine) prefetchRow(section); // 没有整段上下文时不预读
      if (section.childElementCount) ctx.container.append(section);
    };
    const prefetchRow = (section: HTMLElement) => {
      const row = document.createElement('label');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
      });
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'checkbox checkbox-sm';
      box.checked = isAutoPrefetch(book);
      box.disabled = getSettings().prefetchAllBooks; // 设置里开了「所有书」时，这里不能单独关
      box.addEventListener('change', () => {
        setAutoPrefetch(book, box.checked);
        if (box.checked) void prefetchFrom();
      });
      row.append(
        box,
        document.createTextNode(
          getSettings().prefetchAllBooks
            ? `所有书句子预读（往后 ${getSettings().prefetchAhead} 截，设置里改）`
            : `本书句子预读（往后 ${getSettings().prefetchAhead} 截）`,
        ),
      );
      // 进度单独一行（句子、生词分开），不挤在句子预读的开关后面
      statusEl = document.createElement('div');
      statusEl.style.opacity = '0.7';
      section.append(row, statusEl);
      if (box.checked || getSettings().vocabPrefetch) pendingPrefetch = true;
    };
    // 生词预读的短答案（只有意思、原形、构词）：「完整解释」按自己选中查词那样问一次 AI（长提示词），
    // 卡片换成完整的，记录也换成完整的，下次直接显示完整的（开发者 10-23，甲）
    const fullButton = (section: HTMLElement) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline self-start';
      btn.textContent = '完整解释';
      btn.addEventListener('click', () => {
        btn.disabled = true;
        void askAI();
      });
      section.append(btn);
    };
    // 查的是单词或短语：两个开关按钮，按当前状态显示，点一下切换；最右边「生词本」直接打开生词本
    //   生词本：在生词本里 ⇄ 已移出（移出后再查会回来）
    //     点透镜小字查的也算（开发者 10-21：划词、点透镜都说明不认识），不用另外「加入生词本」
    //   忽略：没忽略 ⇄ 已忽略（忽略后再查也不进生词本）
    const vocabButtons = (section: HTMLElement, answer: string) => {
      if (!isVocab(answer, word)) return;
      const lemma = lemmaOf({ word, answer });
      if (!lemma) return;
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
      let removed = false;
      const btnVocab = document.createElement('button');
      const btnIgnore = document.createElement('button');
      const btnBook = document.createElement('button');
      const paint = () => {
        const ignored = isIgnored(lemma);
        btnVocab.textContent = removed ? `已移出生词本 · 点击放回` : '移出生词本';
        btnVocab.className = `btn btn-sm ${removed ? 'btn-active' : 'btn-outline'}`;
        btnVocab.disabled = ignored;
        btnIgnore.textContent = ignored ? `已忽略 · 点击取消` : '忽略这个词';
        btnIgnore.className = `btn btn-sm ${ignored ? 'btn-active' : 'btn-outline'}`;
      };
      for (const b of [btnVocab, btnIgnore, btnBook]) b.type = 'button';
      btnBook.textContent = '生词本';
      btnBook.className = 'btn btn-sm btn-outline';
      btnBook.style.marginInlineStart = 'auto'; // 靠最右
      btnBook.addEventListener('click', () => void openVocabBook());
      btnVocab.addEventListener('click', () => {
        if (removed) undeleteVocab(lemma);
        else deleteVocab(lemma);
        removed = !removed;
        paint();
        remarkOpenDocs(book); // 移出的词书里不标
      });
      btnIgnore.addEventListener('click', () => {
        if (isIgnored(lemma)) unignoreVocab(lemma);
        else ignoreVocab(lemma);
        paint();
        remarkOpenDocs(book); // 忽略了的词书里不标
      });
      paint();
      row.append(btnVocab, btnIgnore, btnBook);
      section.append(row);
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
        source: lensSource ?? 'prefetch',
        createdAt: Date.now(),
        ...(nth > 1 ? { nth } : {}),
      });
    // 问 AI（长提示词），边出边显示，存进「自己查过的」。没查过时走这里；短答案上点「完整解释」也走这里。
    // 放在「本机记录」「预读」那两条直接返回的路前面：按钮在那两条路上，点的时候要用到它
    const askAI = async () => {
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
          system,
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
        if (ctx.signal.aborted)
          return { ok: false as const, reason: 'error' as const, message: 'aborted' };
        answer = stripReasoning(answer);
        render(ctx.container, answer, true);
        footer(answer);
        if (answer) {
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
          cache.set(key, answer);
          await saving; // 短答案刚记进去的那次先存完，免得旧的盖掉新的
          saving = saveHistory({
            key,
            book,
            word,
            sentence,
            context,
            answer,
            model: translator.model ?? '',
            promptVersion: PROMPT_VERSION,
            source: lensSource ?? 'lookup',
            createdAt: Date.now(),
            ...(nth > 1 ? { nth } : {}),
          }).then(() => remarkOpenDocs(book)); // 刚查的词在书里标出来
        }
        kickPrefetch(); // 记录存完再往后预读
        return { ok: true as const, headword: word, sourceLabel: translator.name };
      } catch (err) {
        if (ctx.signal.aborted)
          return { ok: false as const, reason: 'error' as const, message: 'aborted' };
        const p = document.createElement('p');
        p.className = 'text-sm text-error mt-2';
        p.textContent = `查询失败：${err instanceof Error ? err.message : String(err)}`;
        ctx.container.append(p);
        return { ok: true as const, headword: word, sourceLabel: translator.name };
      } finally {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', abort);
      }
    };
    if (hit) {
      cache.set(key, hit);
      render(ctx.container, hit, true, '本机记录');
      footer(hit);
      kickPrefetch();
      return { ok: true, headword: word, sourceLabel: translator.name };
    }
    // 选中的是预读过的一截或一句（至少 3 个词），或者按生词预读过的「这个词在这一句里」
    const pre =
      (await findPrefetched(book, word)) ?? (await findPrefetchedWord(book, word, sentence, nth));
    if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
    if (pre) {
      cache.set(key, pre.answer);
      saving = keep(pre.answer);
      render(ctx.container, pre.answer, true, pre.note);
      footer(pre.answer);
      kickPrefetch(); // 预读的答案记进「自己查过的」之后再往后预读
      return { ok: true, headword: word, sourceLabel: translator.name };
    }
    return askAI();
  },
};
