// 「这本书的介绍」窗口（bookIntro.ts）：打开时有存过的就直接显示，没有就问 AI、边出边显示；可以重新生成。
// 从底部工具栏「语境查词」面板打开（ToolbarButton.tsx）。排版用查词卡片那套（render.ts）。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBookDataStore } from '@/store/bookDataStore';
import { useThemeStore } from '@/store/themeStore';
import { makeIntro, savedIntro, type BookInfo } from './bookIntro';
import { odyboBookName } from './marks';
import { renderAnswer } from './render';

/** Readest 书本信息里可能是字符串、数组或带 name 的对象，统一成一段文字 */
const textOf = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('、');
  if (typeof v === 'object') {
    const o = v as { name?: unknown };
    if (typeof o.name === 'string') return o.name;
    if (o.name && typeof o.name === 'object') return Object.values(o.name)[0] as string;
  }
  return '';
};

const BookIntroDialog: React.FC<{ bookKey: string; onClose: () => void }> = ({
  bookKey,
  onClose,
}) => {
  const { getBookData } = useBookDataStore();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const data = getBookData(bookKey);
  const book = odyboBookName(data?.book);
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const info = (): BookInfo => {
    const meta = (data?.bookDoc?.metadata ?? {}) as unknown as Record<string, unknown>;
    const toc: string[] = [];
    const walk = (items?: { label?: string; subitems?: unknown[] }[]) => {
      for (const it of items ?? []) {
        if (toc.length >= 40) return;
        if (it.label) toc.push(it.label);
        walk(it.subitems as { label?: string; subitems?: unknown[] }[]);
      }
    };
    walk(data?.bookDoc?.toc as { label?: string; subitems?: unknown[] }[] | undefined);
    return {
      title: data?.book?.title || textOf(meta['title']) || '（未知）',
      author: data?.book?.author || textOf(meta['author']),
      publisher: textOf(meta['publisher']),
      published: textOf(meta['published']),
      subject: textOf(meta['subject']),
      description: textOf(meta['description']),
      toc,
    };
  };

  const show = (answer: string, done: boolean, note = '') => {
    if (!box.current) return;
    box.current.textContent = '';
    renderAnswer(box.current, answer, { word: '', sentence: '', done, dark: isDarkMode, note });
  };

  const generate = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError('');
    show('', false);
    try {
      const answer = await makeIntro(book, info(), (t) => show(t, false), ctrl.signal);
      if (!ctrl.signal.aborted) show(answer, true);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(`生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  useEffect(() => {
    void savedIntro(book).then((saved) => {
      if (saved) show(saved, true, '本机记录（可以重新生成）');
      else void generate();
    });
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className='fixed inset-0 z-[60] bg-black/30' onClick={onClose}>
      <div
        className='bg-base-200 text-base-content fixed left-1/2 top-1/2 flex max-h-[85vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl shadow-xl'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3'>
          <div className='min-w-0'>
            <div className='text-sm font-semibold'>这本书的介绍</div>
            <div className='text-base-content/60 truncate text-xs'>{book}</div>
          </div>
          <div className='flex shrink-0 gap-2'>
            <button
              type='button'
              className='btn btn-sm btn-outline'
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? '生成中…' : '重新生成'}
            </button>
            <button type='button' className='btn btn-sm' onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div className='overflow-y-auto px-4 py-3 text-sm'>
          {error && <div className='text-error mb-2'>{error}</div>}
          <div ref={box} />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BookIntroDialog;
