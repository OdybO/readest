// 「语境查词」设置页：挂在 Readest 设置窗口的标签里（接入点：components/settings/SettingsDialog.tsx）。
// 用 Readest 的设置卡片样式；说明收在名字右边的 ⓘ 里，点一下才显示。以后生词本的设置也放这里。
import React, { useState } from 'react';
import { FiInfo, FiMinus, FiPlus } from 'react-icons/fi';
import { MdChevronRight } from 'react-icons/md';
import VocabPage from './VocabPage';
import { BoxedList } from '@/components/settings/primitives';
import { Toggle } from '@/components/primitives/toggle';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type OdyboSettings } from './settings';
import { takeOpenVocab } from './vocabLink';
import { getPrompts, refreshPrompts } from './remotePrompts';
import { formatTime } from './vocab';
import { deviceId, lastSync, overwriteNow, syncNow } from './dataSync';

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

/** 上次同步的结果，和「立即同步」按钮（dataSync.ts） */
/** 要点两次的按钮：第一次变红、字换成「再点一次…」，3 秒内再点才执行（覆盖会丢数据，免得误点；开发者 10-23） */
const ConfirmButton: React.FC<{
  label: string;
  confirm: string;
  disabled: boolean;
  onConfirm: () => void;
}> = ({ label, confirm, disabled, onConfirm }) => {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type='button'
      className={`btn btn-sm shrink-0 ${armed ? 'btn-error' : 'btn-outline'}`}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirm : label}
    </button>
  );
};

/** 同步：合并（照原来，两边都留，同一条新的为准）、拉取（WebDAV 覆盖本机）、推送（本机覆盖 WebDAV）；后两个要点两次 */
const SyncStatusRow: React.FC<{ onPulled: () => void }> = ({ onPulled }) => {
  const [st, setSt] = useState(() => lastSync());
  const [busy, setBusy] = useState('');
  const run = async (what: string, job: () => Promise<ReturnType<typeof lastSync>>) => {
    setBusy(what);
    setSt(await job());
    setBusy('');
  };
  return (
    <div className='flex flex-col gap-2 pe-4 pb-3'>
      <div className='flex min-h-14 flex-col justify-center'>
        <span className='settings-content'>
          {st.at ? `上次同步 ${formatTime(st.at)}` : '还没同步过'}
        </span>
        <span className='text-base-content/60 text-xs'>{st.message}</span>
        <span className='text-base-content/60 text-xs'>这台设备：{deviceId()}</span>
      </div>
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          className='btn btn-sm btn-outline shrink-0'
          disabled={!!busy}
          onClick={() => run('合并', syncNow)}
        >
          {busy === '合并' ? '同步中…' : '合并'}
        </button>
        <ConfirmButton
          label={busy === '拉取' ? '拉取中…' : '拉取'}
          confirm='再点一次：本机换成 WebDAV 上的'
          disabled={!!busy}
          onConfirm={() =>
            run('拉取', async () => {
              const r = await overwriteNow('pull');
              onPulled(); // 设置也换了，页面上的跟着变
              return r;
            })
          }
        />
        <ConfirmButton
          label={busy === '推送' ? '推送中…' : '推送'}
          confirm='再点一次：WebDAV 换成本机的'
          disabled={!!busy}
          onConfirm={() => run('推送', () => overwriteNow('push'))}
        />
      </div>
      <span className='text-base-content/60 text-xs'>
        合并：两边都留，同一条以新的为准。拉取：本机的查词记录、预读、生词移出和忽略、设置全换成
        WebDAV 上的，本机多出来的没了。推送：WebDAV 换成本机的，WebDAV
        上多出来的（包括别的设备的文件夹）删掉。拉取、推送要点两次。
      </span>
    </div>
  );
};

/** 提示词从哪来（remotePrompts.ts）：WebDAV 上的那份，还是 App 自带的；可以马上重新读一遍 */
const PromptBox: React.FC = () => {
  const [p, setP] = useState(() => getPrompts());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const when = p.fetchedAt ? formatTime(p.fetchedAt) : '';
  return (
    <BoxedList title='提示词'>
      <div className='flex min-h-14 items-center justify-between gap-4 pe-4'>
        <div className='flex flex-col'>
          <span className='settings-content'>
            {p.source === 'webdav' ? `用 WebDAV 上的（${when} 读到）` : '用 App 自带的'}
          </span>
          <span className='text-base-content/60 text-xs'>
            放在 WebDAV 根目录下
            odybo/prompts/：system.txt、chunk.txt、vocab_hint.txt、vocab_prefetch.txt
            等；改了不用重新编译，最多 10 分钟自动读一次
          </span>
          {msg && <span className='text-base-content/70 text-xs'>{msg}</span>}
        </div>
        <button
          type='button'
          className='btn btn-sm btn-outline shrink-0'
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(await refreshPrompts(true));
            setP(getPrompts());
            setBusy(false);
          }}
        >
          {busy ? '读取中…' : '重新读取'}
        </button>
      </div>
    </BoxedList>
  );
};

const OdyboSettingsPanel: React.FC = () => {
  const [s, setS] = useState<OdyboSettings>(() => getSettings());
  const [page, setPage] = useState<'main' | 'vocab'>(() => (takeOpenVocab() ? 'vocab' : 'main'));
  const update = (patch: Partial<OdyboSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  if (page === 'vocab') return <VocabPage onBack={() => setPage('main')} />;

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList>
        <button
          type='button'
          className='flex min-h-14 w-full items-center justify-between pe-4 text-start'
          onClick={() => setPage('vocab')}
        >
          <span className='settings-content'>生词本</span>
          <MdChevronRight className='text-base-content/50 h-5 w-5' />
        </button>
      </BoxedList>

      <PromptBox />

      <BoxedList title='同步到 WebDAV'>
        <Row
          label='同步查词记录和生词本'
          tip='用 Readest 里设置的 WebDAV，放在根目录下 odybo/data/。每台设备只写自己的文件夹、读别人的，合并时同一条以时间新的为准。打开书、查词时最多 10 分钟同步一次，本机改了 1 分钟后上传。重装或换设备后打开就能拿回来。'
        >
          <Toggle checked={s.syncData} onChange={() => update({ syncData: !s.syncData })} />
        </Row>
        <Row label='也同步预读结果' tip='预读结果比查词记录多得多，太大时可以关掉。'>
          <Toggle
            checked={s.syncPrefetch}
            disabled={!s.syncData}
            onChange={() => update({ syncPrefetch: !s.syncPrefetch })}
          />
        </Row>
        <SyncStatusRow onPulled={() => setS(getSettings())} />
      </BoxedList>

      <BoxedList title='句子预读'>
        <Row label='预读截数' tip='提前查询后面 N 截。短句一整句为一截，长句按逗号分成几截。'>
          <Stepper
            value={s.prefetchAhead}
            min={1}
            max={10}
            onChange={(v) => update({ prefetchAhead: v })}
          />
        </Row>
        <Row
          label='难句分数线'
          tip='只预读看上去难的句子：按从句、插入语、倒装、难懂短语等打分，到这么多分才预读。0 = 不挑，往后挨着预读。'
        >
          <Stepper
            value={s.sentenceMinScore}
            min={0}
            max={10}
            onChange={(v) => update({ sentenceMinScore: v })}
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
        <Row
          label='所有书句子预读'
          tip='开：每本书都预读句子。关：每本书在查词卡片底下、或底栏「语境查词」里单独开。生词预读另外管（底栏「生词预读」）。'
        >
          <Toggle
            checked={s.prefetchAllBooks}
            onChange={() => update({ prefetchAllBooks: !s.prefetchAllBooks })}
          />
        </Row>
      </BoxedList>

      <BoxedList title='生词预读'>
        <Row
          label='查过几次才预读'
          tip='生词本里查过 N 次以上的词才预读（在不同的地方查才算，同一处再查不加）。第一次查的那一处本来就标着。'
        >
          <Stepper
            value={s.vocabMinCount}
            min={1}
            max={20}
            unit='次'
            onChange={(v) => update({ vocabMinCount: v })}
          />
        </Row>
        <Row label='最近几天' tip='只看最近 N 天查过的生词。太久没查的不预读。'>
          <Stepper
            value={s.vocabDays}
            min={1}
            max={365}
            unit='天'
            onChange={(v) => update({ vocabDays: v })}
          />
        </Row>
        <Row
          label='往后备好几个'
          tip='查完词后，从这里往后（到本章末尾）保持这么多个生词已经查好。同一个词在不同的句子里各算一个。0 = 不预读生词。'
        >
          <Stepper
            value={s.vocabPerRun}
            min={0}
            max={20}
            unit='个'
            onChange={(v) =>
              update({
                vocabPerRun: v,
                vocabRefillAt: Math.min(s.vocabRefillAt, Math.max(0, v - 1)),
              })
            }
          />
        </Row>
        <Row
          label='剩几个就补'
          tip='往后查好的生词只剩这么多个（或更少）时，才一次补满；没到就不问 AI。设得低，一次补得多、更省；设得高，往后总有查好的，但每次只补一两个。'
        >
          <Stepper
            value={s.vocabRefillAt}
            min={0}
            max={Math.max(0, s.vocabPerRun - 1)}
            unit='个'
            onChange={(v) => update({ vocabRefillAt: v })}
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
