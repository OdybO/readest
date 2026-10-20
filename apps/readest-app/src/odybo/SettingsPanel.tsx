// 「语境查词」设置页：挂在 Readest 设置窗口的标签里（接入点：components/settings/SettingsDialog.tsx）。
// 用 Readest 自己的设置界面组件，看起来和别的设置页一样。以后生词本的设置也放这里。
import React, { useEffect, useState } from 'react';
import { BoxedList, SettingsRow, SettingsSwitchRow } from '@/components/settings/primitives';
import NumberInput from '@/components/settings/NumberInput';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type OdyboSettings } from './settings';
import { HISTORY, PREFETCH, countRecords } from './history';

/** 一项设置 + 它下面的灰色说明（可以多行；Readest 自带的说明只显示一行）。 */
const Described: React.FC<{ note: React.ReactNode; children: React.ReactNode }> = ({
  note,
  children,
}) => (
  <div className='pb-3'>
    {children}
    <p className='text-base-content/65 -mt-2 pe-4 text-[0.8em] leading-relaxed'>{note}</p>
  </div>
);

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
      <BoxedList title='句子预读'>
        <Described
          note={
            <>
              每次查完，从你选中的地方往后，提前把几截查好存起来；你读到那里再选，马上就出来。
              <br />
              一截 = 20 个词以内的一整句，或者长句在逗号、分号处切开的一段（8～20
              个词）。长句的整句也会另外查一份，不算在这个数里。
              <br />
              数字越大，往后能马上出来的越多，花的 token 也越多。
            </>
          }
        >
          <NumberInput
            label='往后预读几截'
            value={s.prefetchAhead}
            min={1}
            max={10}
            onChange={(v) => update({ prefetchAhead: v })}
          />
        </Described>
        <Described
          note={
            <>
              预读时一次同时问 AI 几截。多一些，预读完得快；但会和你自己查词同时挤在 N1
              上，你自己查词可能变慢。 少一些，预读慢一点，你自己查词不受影响。
            </>
          }
        >
          <NumberInput
            label='预读同时查几截'
            value={s.prefetchParallel}
            min={1}
            max={6}
            onChange={(v) => update({ prefetchParallel: v })}
          />
        </Described>
        <Described note='开着：每本书查完都自动预读，查词卡片底下的「本书自动预读」变灰、不能单独关。关着：每本书在查词卡片底下单独勾。'>
          <SettingsSwitchRow
            label='所有书都自动预读'
            checked={s.prefetchAllBooks}
            onChange={() => update({ prefetchAllBooks: !s.prefetchAllBooks })}
          />
        </Described>
      </BoxedList>

      <BoxedList title='本机记录'>
        <Described note='你自己选中查过的。同一本书、同一处再查，直接显示（卡片底下标「本机记录」），不再问 AI。关掉 App 也在。'>
          <SettingsRow label='自己查过的'>
            <span className='text-base-content/70 text-sm'>
              {counts ? `${counts.history} 条` : '…'}
            </span>
          </SettingsRow>
        </Described>
        <Described note='预读提前查好的句子和截。你选中它们时直接显示（卡片底下标「预读」）。'>
          <SettingsRow label='预读好的'>
            <span className='text-base-content/70 text-sm'>
              {counts ? `${counts.prefetch} 条` : '…'}
            </span>
          </SettingsRow>
        </Described>
      </BoxedList>

      <BoxedList>
        <Described note='上面三项设置回到默认（预读 3 截、同时查 3 截、不自动预读所有书）。不会删本机记录。'>
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
        </Described>
      </BoxedList>
    </div>
  );
};

export default OdyboSettingsPanel;
