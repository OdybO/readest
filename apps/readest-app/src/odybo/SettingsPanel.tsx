// 「语境查词」设置页：挂在 Readest 设置窗口的标签里（接入点：components/settings/SettingsDialog.tsx）。
// 用 Readest 自己的设置界面组件，看起来和别的设置页一样。以后生词本的设置也放这里。
import React, { useEffect, useState } from 'react';
import { BoxedList, SettingsRow, SettingsSwitchRow } from '@/components/settings/primitives';
import NumberInput from '@/components/settings/NumberInput';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type OdyboSettings } from './settings';
import { HISTORY, PREFETCH, countRecords } from './history';

const OdyboSettingsPanel: React.FC = () => {
  const [s, setS] = useState<OdyboSettings>(() => getSettings());
  const [counts, setCounts] = useState<{ history: number; prefetch: number } | null>(null);

  useEffect(() => {
    void Promise.all([countRecords(HISTORY), countRecords(PREFETCH)]).then(([history, prefetch]) =>
      setCounts({ history, prefetch }),
    );
  }, []);

  const update = (patch: Partial<OdyboSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList
        title='句子预读'
        description='查过一处后，在后台把后面的句子提前查好，点下去直接显示。一截 = 20 个词以内的整句，或长句切成的 8～20 个词的一段；长句的整句也会另外预读一份。预读要花 token。'
      >
        <NumberInput
          label='往后预读几截'
          value={s.prefetchAhead}
          min={1}
          max={10}
          onChange={(v) => update({ prefetchAhead: v })}
        />
        <NumberInput
          label='同时最多几个请求'
          value={s.prefetchParallel}
          min={1}
          max={6}
          onChange={(v) => update({ prefetchParallel: v })}
        />
        <SettingsSwitchRow
          label='所有书都自动预读'
          description='关着时，每本书在查词卡片底下单独勾「本书自动预读」。'
          checked={s.prefetchAllBooks}
          onChange={() => update({ prefetchAllBooks: !s.prefetchAllBooks })}
        />
      </BoxedList>

      <BoxedList title='本机记录' description='存在这台设备上，关掉 App 也在。'>
        <SettingsRow label='自己查过的'>
          <span className='text-base-content/70 text-sm'>
            {counts ? `${counts.history} 条` : '…'}
          </span>
        </SettingsRow>
        <SettingsRow label='预读好的'>
          <span className='text-base-content/70 text-sm'>
            {counts ? `${counts.prefetch} 条` : '…'}
          </span>
        </SettingsRow>
      </BoxedList>

      <BoxedList>
        <SettingsRow label='恢复默认设置'>
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
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default OdyboSettingsPanel;
