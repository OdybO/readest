// 生词本页面：从「语境查词」设置页里的「生词本 >」进来。
// 三栏（一周内 / 一个月内 / 更早，按最近一次查询）；每行：原形、次数、最近一次的意思、最近查询时间；
// 点开看各种写法和每一次查询的书、时间、原句（查的那个词粉色加粗）；可以删除（再查一次会回来）。
import React, { useEffect, useMemo, useState } from 'react';
import { MdChevronLeft } from 'react-icons/md';
import { VOCAB_TABS, deleteVocab, formatTime, inTab, loadVocab, type VocabEntry } from './vocab';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 原句里把查的那个词标粉色加粗。 */
const Sentence: React.FC<{ text: string; word: string }> = ({ text, word }) => {
  if (!text) return null;
  const m = word.trim() ? text.match(new RegExp(esc(word.trim()), 'i')) : null;
  if (!m || m.index === undefined) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, m.index)}
      <b className='text-pink-500'>{m[0]}</b>
      {text.slice(m.index + m[0].length)}
    </span>
  );
};

const VocabRow: React.FC<{ e: VocabEntry; onDelete: () => void }> = ({ e, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <div className='pe-4'>
      <button
        type='button'
        className='flex min-h-14 w-full items-center gap-3 text-start'
        onClick={() => setOpen(!open)}
      >
        <span className='min-w-0 flex-1'>
          <span className='font-semibold'>{e.lemma}</span>
          <span className='text-base-content/60 ms-2 text-sm'>{e.count} 次</span>
          <span className='text-base-content/80 block truncate text-sm'>{e.meaning}</span>
        </span>
        <span className='text-base-content/60 shrink-0 text-xs'>{formatTime(e.last)}</span>
      </button>
      {open && (
        <div className='space-y-2 pb-3 text-sm'>
          {e.forms.length > 1 && (
            <div className='text-base-content/70'>写法：{e.forms.join('、')}</div>
          )}
          {e.lookups.map((l) => (
            <div key={l.createdAt} className='border-base-200 border-s-2 ps-2'>
              <div className='text-base-content/60 text-xs'>
                {l.book || '（未知书名）'}　{formatTime(l.createdAt)}
              </div>
              <div className='italic'>
                <Sentence text={l.sentence} word={l.word} />
              </div>
            </div>
          ))}
          <div className='flex justify-end'>
            <button
              type='button'
              className={`btn btn-sm ${confirming ? 'btn-error' : 'btn-ghost'}`}
              onClick={() => (confirming ? onDelete() : setConfirming(true))}
            >
              {confirming ? '再点一次确认删除' : '删除'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const VocabPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [list, setList] = useState<VocabEntry[] | null>(null);
  const [tab, setTab] = useState<(typeof VOCAB_TABS)[number]['id']>('week');
  const reload = () => void loadVocab().then(setList);
  useEffect(reload, []);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        VOCAB_TABS.map((t) => [t.id, (list ?? []).filter((e) => inTab(e, t)).length]),
      ),
    [list],
  );
  const current = VOCAB_TABS.find((t) => t.id === tab)!;
  const shown = (list ?? []).filter((e) => inTab(e, current));

  return (
    <div className='my-4 w-full space-y-4'>
      <button type='button' className='btn btn-ghost btn-sm gap-1 ps-1' onClick={onBack}>
        <MdChevronLeft className='h-5 w-5' />
        生词本
      </button>
      <div role='tablist' className='tabs tabs-boxed w-fit'>
        {VOCAB_TABS.map((t) => (
          <button
            key={t.id}
            type='button'
            role='tab'
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}（{counts[t.id] ?? 0}）
          </button>
        ))}
      </div>
      <div className='card eink-bordered border-base-200 bg-base-100 border'>
        <div className='divide-base-200 divide-y ps-4'>
          {list === null && <div className='text-base-content/60 py-4 text-sm'>读取中…</div>}
          {list !== null && shown.length === 0 && (
            <div className='text-base-content/60 py-4 text-sm'>这一栏还没有生词。</div>
          )}
          {shown.map((e) => (
            <VocabRow
              key={e.lemma}
              e={e}
              onDelete={() => {
                deleteVocab(e.lemma);
                reload();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default VocabPage;
