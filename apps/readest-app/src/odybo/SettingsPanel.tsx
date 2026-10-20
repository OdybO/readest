// 「语境查词」设置页：挂在 Readest 设置窗口的标签里（接入点：components/settings/SettingsDialog.tsx）。
// 用 Readest 的设置卡片样式；说明收在名字右边的 ⓘ 里，点一下才显示。以后生词本的设置也放这里。
import React, { useState } from 'react';
import { FiInfo, FiMinus, FiPlus } from 'react-icons/fi';
import { BoxedList } from '@/components/settings/primitives';
import { Toggle } from '@/components/primitives/toggle';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type OdyboSettings } from './settings';

/** 一行设置：名字 + ⓘ（点开说明）+ 右边的控件；说明显示在这一行下面。 */
const Row: React.FC<{ label: string; tip: string; children: React.ReactNode }> = ({
  label,
  tip,
  children,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className='pe-4'>
      <div className='flex min-h-14 items-center justify-between gap-3'>
        <div className='flex items-center gap-1.5'>
          <span className='settings-content'>{label}</span>
          <button
            type='button'
            aria-label={`${label}说明`}
            aria-expanded={open}
            className='btn btn-ghost btn-xs btn-circle text-base-content/50'
            onClick={() => setOpen(!open)}
          >
            <FiInfo className='h-4 w-4' />
          </button>
        </div>
        {children}
      </div>
      {open && (
        <p className='text-base-content/65 -mt-2 pb-3 text-[0.8em] leading-relaxed'>{tip}</p>
      )}
    </div>
  );
};

const Stepper: React.FC<{
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}> = ({ value, min, max, unit, onChange }) => (
  <div className='flex items-center gap-2'>
    <span className='min-w-10 text-right'>
      {value}
      {unit && <span className='text-base-content/60 ms-0.5 text-[0.85em]'>{unit}</span>}
    </span>
    <button
      type='button'
      aria-label='减少'
      className={`btn btn-circle btn-sm ${value <= min ? 'btn-disabled' : ''}`}
      onClick={() => onChange(Math.max(min, value - 1))}
    >
      <FiMinus className='h-4 w-4' />
    </button>
    <button
      type='button'
      aria-label='增加'
      className={`btn btn-circle btn-sm ${value >= max ? 'btn-disabled' : ''}`}
      onClick={() => onChange(Math.min(max, value + 1))}
    >
      <FiPlus className='h-4 w-4' />
    </button>
  </div>
);

const OdyboSettingsPanel: React.FC = () => {
  const [s, setS] = useState<OdyboSettings>(() => getSettings());
  const update = (patch: Partial<OdyboSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList title='句子预读'>
        <Row label='预读截数' tip='提前查询后面 N 截。短句一整句为一截，长句按逗号分成几截。'>
          <Stepper
            value={s.prefetchAhead}
            min={1}
            max={10}
            onChange={(v) => update({ prefetchAhead: v })}
          />
        </Row>
        <Row label='短句长度' tip='不超过这么多词的句子算短句；超过的算长句，按逗号分成几截。'>
          <Stepper
            value={s.shortSentenceWords}
            min={10}
            max={60}
            unit='词'
            onChange={(v) => update({ shortSentenceWords: v })}
          />
        </Row>
        <Row label='所有书自动预读' tip='开：每本书都预读。关：每本书在查词卡片底下单独勾。'>
          <Toggle
            checked={s.prefetchAllBooks}
            onChange={() => update({ prefetchAllBooks: !s.prefetchAllBooks })}
          />
        </Row>
      </BoxedList>

      <BoxedList>
        <Row label='恢复默认' tip='设置回到默认，不删记录。'>
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            onClick={() => {
              setS({ ...DEFAULT_SETTINGS });
              saveSettings({ ...DEFAULT_SETTINGS });
            }}
          >
            恢复
          </button>
        </Row>
      </BoxedList>
    </div>
  );
};

export default OdyboSettingsPanel;
