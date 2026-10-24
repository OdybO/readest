// 生词本页面：从「语境查词」设置页里的「生词本 >」进来。
// 三栏（一周内 / 一个月内 / 更早，按最近一次查询）；每行：原形、次数、最近一次的意思、最近查询时间；
// 点开看各种写法和每一次查询的书、时间、原句（查的那个词粉色加粗）；可以删除（再查一次会回来）或忽略（再查也不进）。
// 第四栏「已忽略」：忽略过的词，可以恢复。
// 三栏里可以切换排序（开发者 10-23）：次数（多的在前，一样多按最近）/ 最新（最近查的在前）；选了记在本机 localStorage。
import React, { useEffect, useMemo, useState } from 'react';
import { MdChevronLeft } from 'react-icons/md';
import {
  VOCAB_TABS,
  deleteVocab,
  formatTime,
  getIgnored,
  ignoreVocab,
  inTab,
  loadVocab,
  unignoreVocab,
  type VocabEntry,
} from './vocab';

type SortBy = 'count' | 'last';
const SORT_KEY = 'odybo.vocabSort';
const loadSort = (): SortBy => {
  try {
    return localStorage.getItem(SORT_KEY) === 'last' ? 'last' : 'count';
  } catch {
    return 'count';
  }
};
const SORTS: { id: SortBy; label: string }[] = [
  { id: 'count', label: '次数' },
  { id: 'last', label: '最新' },
];

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

const VocabRow: React.FC<{ e: VocabEntry; onDelete: () => void; onIgnore: () => void }> = ({
  e,
  onDelete,
  onIgnore,
}) => {
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
          <div className='flex justify-end gap-2'>
            <button type='button' className='btn btn-ghost btn-sm' onClick={onIgnore}>
              忽略
            </button>
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
  const [tab, setTab] = useState<(typeof VOCAB_TABS)[number]['id'] | 'ignored'>('week');
  const [ignored, setIgnored] = useState<Record<string, number>>(() => getIgnored());
  const reload = () => {
    setIgnored(getIgnored());
    void loadVocab().then(setList);
  };
  useEffect(reload, []);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        VOCAB_TABS.map((t) => [t.id, (list ?? []).filter((e) => inTab(e, t)).length]),
      ),
    [list],
  );
  const [sortBy, setSortBy] = useState<SortBy>(loadSort);
  const chooseSort = (s: SortBy) => {
    setSortBy(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {}
  };
  const current = VOCAB_TABS.find((t) => t.id === tab);
  // loadVocab 已按次数排好；选「最新」时按最近一次查询重排
  const shown = current ? (list ?? []).filter((e) => inTab(e, current)) : [];
  if (sortBy === 'last') shown.sort((a, b) => b.last - a.last);
  const ignoredList = Object.entries(ignored).sort((a, b) => b[1] - a[1]);

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
        <button
          type='button'
          role='tab'
          className={`tab ${tab === 'ignored' ? 'tab-active' : ''}`}
          onClick={() => setTab('ignored')}
        >
          已忽略（{ignoredList.length}）
        </button>
      </div>
      {tab !== 'ignored' && (
        <div className='flex items-center gap-2 text-sm'>
          <span className='text-base-content/60'>排序</span>
          <div role='tablist' className='tabs tabs-boxed tabs-sm w-fit'>
            {SORTS.map((s) => (
              <button
                key={s.id}
                type='button'
                role='tab'
                className={`tab ${sortBy === s.id ? 'tab-active' : ''}`}
                onClick={() => chooseSort(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className='card eink-bordered border-base-200 bg-base-100 border'>
        <div className='divide-base-200 divide-y ps-4'>
          {tab !== 'ignored' && list === null && (
            <div className='text-base-content/60 py-4 text-sm'>读取中…</div>
          )}
          {tab === 'ignored' &&
            (ignoredList.length === 0 ? (
              <div className='text-base-content/60 py-4 text-sm'>没有忽略的词。</div>
            ) : (
              ignoredList.map(([lemma, t]) => (
                <div key={lemma} className='flex min-h-14 items-center justify-between gap-3 pe-4'>
                  <span>
                    <span className='font-semibold'>{lemma}</span>
                    <span className='text-base-content/60 ms-2 text-xs'>{formatTime(t)} 忽略</span>
                  </span>
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm'
                    onClick={() => {
                      unignoreVocab(lemma);
                      reload();
                    }}
                  >
                    恢复
                  </button>
                </div>
              ))
            ))}
          {tab !== 'ignored' && list !== null && shown.length === 0 && (
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
              onIgnore={() => {
                ignoreVocab(e.lemma);
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
