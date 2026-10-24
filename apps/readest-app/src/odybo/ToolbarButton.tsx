// 阅读界面底部工具栏里我们的按钮：点开一个小面板，几个开关——显示透镜、生词预读、生词标法、词组下划虚线、点的位置、单击查词、本书句子预读。
// 接入点：footerbar/NavigationBar.tsx（手机 / 平板底栏）和 footerbar/DesktopFooterBar.tsx（电脑底栏）各放一个 <OdyboToolbarButton>。
// 面板用 portal 挂到页面最外层，免得被底栏的滚动区域裁掉。
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { PiBookOpenText } from 'react-icons/pi';
import { FiInfo } from 'react-icons/fi';
import Button from '@/components/Button';
import { Toggle } from '@/components/primitives/toggle';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveViewSettings } from '@/helpers/settings';
import { getSettings, saveSettings, type OdyboSettings } from './settings';
import { isAutoPrefetch, setAutoPrefetch } from './prefetch';
import { odyboBookName, remarkOpenDocs } from './marks';
import BookIntroDialog from './BookIntroDialog';

/** 一行开关：名字 + ⓘ（点开才显示说明，开发者 10-23：说明都摆出来面板太长）+ 右边的控件；照设置页 SettingsPanel.tsx 的 Row。 */
const Row: React.FC<{ label: string; tip?: string; children: React.ReactNode }> = ({
  label,
  tip,
  children,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className='flex min-h-11 items-center justify-between gap-4'>
        <div className='flex items-center gap-1'>
          <span>{label}</span>
          {tip && (
            <button
              type='button'
              aria-label={`${label}说明`}
              aria-expanded={open}
              className='btn btn-ghost btn-xs btn-circle text-base-content/50'
              onClick={() => setOpen(!open)}
            >
              <FiInfo className='h-4 w-4' />
            </button>
          )}
        </div>
        {children}
      </div>
      {open && tip && (
        <p className='text-base-content/65 -mt-1 pb-2 text-xs leading-relaxed'>{tip}</p>
      )}
    </div>
  );
};

const Panel: React.FC<{ bookKey: string; onClose: () => void; onIntro: () => void }> = ({
  bookKey,
  onClose,
  onIntro,
}) => {
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const book = odyboBookName(getBookData(bookKey)?.book);
  const [lens, setLens] = useState(!!getViewSettings(bookKey)?.wordLensEnabled);
  const [s, setS] = useState<OdyboSettings>(() => getSettings());
  const [auto, setAuto] = useState(() => isAutoPrefetch(book));

  const update = (patch: Partial<OdyboSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    remarkOpenDocs(); // 标法、开关变了：打开着的章节马上重标
  };

  return createPortal(
    <div className='fixed inset-0 z-[60]' onClick={onClose}>
      <div
        className='bg-base-200 text-base-content fixed bottom-20 left-1/2 w-[min(92vw,360px)] -translate-x-1/2 rounded-xl p-4 shadow-xl'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='mb-2 text-sm font-semibold'>语境查词</div>
        <button
          type='button'
          className='btn btn-sm btn-outline mb-2 w-full'
          onClick={() => {
            onClose();
            onIntro();
          }}
        >
          这本书的介绍
        </button>
        <Row label='显示透镜' tip='Readest 自带的难词小字'>
          <Toggle
            checked={lens}
            onChange={() => {
              const v = !lens;
              setLens(v);
              void saveViewSettings(envConfig, bookKey, 'wordLensEnabled', v, false, false);
            }}
          />
        </Row>
        <Row
          label='生词预读'
          tip='开着：查完往后找生词提前查好（不用开句子预读）；关掉：不预读生词，书里也不标生词'
        >
          <Toggle
            checked={s.vocabPrefetch}
            onChange={() => update({ vocabPrefetch: !s.vocabPrefetch })}
          />
        </Row>
        <Row label='生词标法' tip='预读过的生词怎么标'>
          <div className='join'>
            {(
              [
                ['gloss', '解释'],
                ['dot', '点'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type='button'
                disabled={!s.vocabPrefetch}
                className={`btn btn-sm join-item ${s.vocabMarkStyle === v ? 'btn-active' : ''}`}
                onClick={() => update({ vocabMarkStyle: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label='词组下划虚线'
          tip='词组用蓝色标；下面再加一条蓝色虚线，看出它管到哪（和书里的标注线重叠时可以关）'
        >
          <Toggle
            checked={s.phraseUnderline}
            disabled={!s.vocabPrefetch}
            onChange={() => update({ phraseUnderline: !s.phraseUnderline })}
          />
        </Row>
        <Row label='点的位置' tip='往下挪几像素，避开上一行词组的虚线（0 = 原来的位置）'>
          <div className='join'>
            <button
              type='button'
              disabled={!s.vocabPrefetch}
              className='btn btn-sm join-item'
              onClick={() => update({ markOffset: Math.max(-6, s.markOffset - 1) })}
            >
              −
            </button>
            <span className='btn btn-sm join-item pointer-events-none min-w-10'>
              {s.markOffset}
            </span>
            <button
              type='button'
              disabled={!s.vocabPrefetch}
              className='btn btn-sm join-item'
              onClick={() => update({ markOffset: Math.min(12, s.markOffset + 1) })}
            >
              +
            </button>
          </div>
        </Row>
        <Row label='单击查词' tip='轻点英文单词直接查；两指轻点呼出菜单；点空白处、页边照旧'>
          <Toggle checked={s.tapLookup} onChange={() => update({ tapLookup: !s.tapLookup })} />
        </Row>
        <Row
          label='本书句子预读'
          tip={
            s.prefetchAllBooks
              ? '设置里开了「所有书句子预读」'
              : `查完往后预读 ${s.prefetchAhead} 截句子（生词预读另外管）`
          }
        >
          <Toggle
            checked={s.prefetchAllBooks || auto}
            disabled={s.prefetchAllBooks}
            onChange={() => {
              setAutoPrefetch(book, !auto);
              setAuto(!auto);
            }}
          />
        </Row>
      </div>
    </div>,
    document.body,
  );
};

const OdyboToolbarButton: React.FC<{ bookKey: string; className?: string }> = ({
  bookKey,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);
  return (
    <>
      <Button
        label='语境查词'
        className={className}
        icon={<PiBookOpenText className={open ? 'text-blue-500' : ''} />}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <Panel bookKey={bookKey} onClose={() => setOpen(false)} onIntro={() => setIntro(true)} />
      )}
      {intro && <BookIntroDialog bookKey={bookKey} onClose={() => setIntro(false)} />}
    </>
  );
};

export default OdyboToolbarButton;
