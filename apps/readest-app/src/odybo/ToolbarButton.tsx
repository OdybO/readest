// 阅读界面底部工具栏里我们的按钮：点开一个小面板，几个开关——显示透镜、生词预读、生词标法、本书自动预读。
// 接入点：footerbar/NavigationBar.tsx（手机 / 平板底栏）和 footerbar/DesktopFooterBar.tsx（电脑底栏）各放一个 <OdyboToolbarButton>。
// 面板用 portal 挂到页面最外层，免得被底栏的滚动区域裁掉。
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { PiBookOpenText } from 'react-icons/pi';
import Button from '@/components/Button';
import { Toggle } from '@/components/primitives/toggle';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveViewSettings } from '@/helpers/settings';
import { getSettings, saveSettings, type OdyboSettings } from './settings';
import { isAutoPrefetch, setAutoPrefetch } from './prefetch';
import { odyboBookName, remarkOpenDocs } from './marks';

const Row: React.FC<{ label: string; tip?: string; children: React.ReactNode }> = ({
  label,
  tip,
  children,
}) => (
  <div className='flex min-h-11 items-center justify-between gap-4'>
    <div className='flex flex-col'>
      <span>{label}</span>
      {tip && <span className='text-base-content/60 text-xs'>{tip}</span>}
    </div>
    {children}
  </div>
);

const Panel: React.FC<{ bookKey: string; onClose: () => void }> = ({ bookKey, onClose }) => {
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
        <Row label='生词预读' tip='关掉：不预读生词，书里也不标生词'>
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
          label='本书自动预读'
          tip={
            s.prefetchAllBooks
              ? '设置里开了「所有书自动预读」'
              : `查完往后预读 ${s.prefetchAhead} 截`
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
  return (
    <>
      <Button
        label='语境查词'
        className={className}
        icon={<PiBookOpenText className={open ? 'text-blue-500' : ''} />}
        onClick={() => setOpen(!open)}
      />
      {open && <Panel bookKey={bookKey} onClose={() => setOpen(false)} />}
    </>
  );
};

export default OdyboToolbarButton;
