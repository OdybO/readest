// 我们的数据同步备份到 WebDAV（开发者 10-21 定）：查词记录、预读结果（可关）、生词的移出和忽略、我们的设置。
// 用 Readest 设置里的 WebDAV 地址、账号、根目录，放在 <根目录>/odybo/data/<设备>/ 下（N1 上是 X:\Private\ReadestSync\odybo\data\）：
//   state.json             移出 / 忽略的词、我们的设置（各带时间）
//   history-YYYY-MM.json   这个月的查词记录（按记录的时间分月）
//   prefetch-YYYY-MM.json  这个月的预读结果
// 每台设备只写自己的文件夹，所以两台同时用不会互相覆盖；每台都读别人的文件夹，同一条（同一本书、同一个内容、同一句）按时间新的为准。
// 重装以后设备名会变，旧设备的文件夹当成「别的设备」读回来，就恢复了。
// 什么时候同步：打开书、查词时最多 10 分钟拉一次；本机数据改了，1 分钟后上传一次；设置页可以马上同步。
// 状态库和 WebDAV 函数用到时再加载（这个文件会被 provider.ts 引用，见 vocabLink.ts 的说明）。
import { HISTORY, PREFETCH, getRecord, listAll, putRecord, type HistoryRecord } from './history';
import { onChange } from './changes';
import { exportFlags, importFlags } from './vocab';
import { exportSettings, getSettings, importSettings } from './settings';

const DEVICE_KEY = 'odybo.deviceId';
const SEEN_KEY = 'odybo.sync.seen'; // 别的设备的文件上次读过的版本（修改时间 + 大小），没变就不再下载
const DIRTY_KEY = 'odybo.sync.dirty'; // 还没上传的文件
const LAST_KEY = 'odybo.sync.last'; // 上次同步：时间 + 一句说明
const PULL_EVERY_MS = 10 * 60_000;
const PUSH_DELAY_MS = 60_000;

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 存不了就只在这次打开时有效
  }
};

/** 这台设备的名字（文件夹名）：android-xxxxxx / web-xxxxxx，第一次用时随机生成 */
export const deviceId = () => {
  let id = read<string>(DEVICE_KEY, '');
  if (!id) {
    const kind =
      typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) ? 'android' : 'web';
    id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    write(DEVICE_KEY, id);
  }
  return id;
};

const monthOf = (t?: number) => {
  const d = new Date(t || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ---------- 本机改了什么：记下要上传的文件，1 分钟后上传 ----------

const dirty = new Set<string>(read<string[]>(DIRTY_KEY, []));
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const markDirty = (file: string) => {
  dirty.add(file);
  write(DIRTY_KEY, [...dirty]);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), PUSH_DELAY_MS);
};
onChange((c) => {
  if (c.kind === 'state') markDirty('state.json');
  else markDirty(`${c.kind}-${monthOf(c.at)}.json`);
});

// ---------- 连 WebDAV ----------

const connect = async () => {
  const st = getSettings();
  if (!st.syncData) return null;
  const [{ useSettingsStore }, client] = await Promise.all([
    import('@/store/settingsStore'),
    import('@/services/sync/providers/webdav/client'),
  ]);
  const w = useSettingsStore.getState().settings?.webdav;
  if (!w?.serverUrl) return null;
  const config = { serverUrl: w.serverUrl, username: w.username, password: w.password };
  const base = `${(w.rootPath || '/').replace(/\/+$/, '')}/odybo/data`;
  return { config, client, base, syncPrefetch: st.syncPrefetch };
};
type Conn = NonNullable<Awaited<ReturnType<typeof connect>>>;

// ---------- 拉：读别的设备的文件，合并进本机 ----------

const importRecords = async (store: string, recs: { key: string; createdAt: number }[]) => {
  let n = 0;
  for (const r of recs) {
    if (!r?.key) continue;
    const mine = await getRecord<{ createdAt: number }>(store, r.key);
    if (!mine || r.createdAt > mine.createdAt) {
      await putRecord(store, r, true);
      n++;
    }
  }
  return n;
};

const pull = async (c: Conn) => {
  const me = deviceId();
  const seen = read<Record<string, string>>(SEEN_KEY, {});
  let files = 0;
  let records = 0;
  let devices: { name: string; path: string; isDirectory: boolean }[] = [];
  try {
    devices = await c.client.listDirectory(c.config, c.base);
  } catch (e) {
    if ((e as { code?: string }).code === 'NOT_FOUND') return { files, records }; // 还没有人传过
    throw e;
  }
  for (const dev of devices) {
    if (!dev.isDirectory || dev.name === me) continue;
    for (const f of await c.client.listDirectory(c.config, dev.path)) {
      if (f.isDirectory || !f.name.endsWith('.json')) continue;
      if (f.name.startsWith('prefetch-') && !c.syncPrefetch) continue;
      const sig = `${f.lastModified ?? ''}|${f.size ?? ''}`;
      if (seen[f.path] === sig) continue;
      const text = await c.client.getFile(c.config, f.path);
      if (text) {
        const data = JSON.parse(text);
        if (f.name === 'state.json') {
          records += importFlags(data.flags ?? {});
          if (importSettings(data.settings)) records++;
        } else if (f.name.startsWith('history-')) {
          records += await importRecords(HISTORY, data.records ?? []);
        } else if (f.name.startsWith('prefetch-')) {
          records += await importRecords(PREFETCH, data.records ?? []);
        }
        files++;
      }
      seen[f.path] = sig;
      write(SEEN_KEY, seen);
    }
  }
  return { files, records };
};

// ---------- 推：把本机改过的月份写成自己的文件 ----------

const buildFile = async (name: string) => {
  const head = { device: deviceId(), updatedAt: Date.now() };
  if (name === 'state.json') return { ...head, flags: exportFlags(), settings: exportSettings() };
  const m = name.match(/^(history|prefetch)-(\d{4}-\d{2})\.json$/);
  if (!m) return null;
  const store = m[1] === 'history' ? HISTORY : PREFETCH;
  const all = await listAll<HistoryRecord>(store);
  return { ...head, records: all.filter((r) => monthOf(r.createdAt) === m[2]) };
};

const push = async (c: Conn) => {
  const me = deviceId();
  const dir = `${c.base}/${me}`;
  const odybo = c.base.replace(/\/data$/, '');
  await c.client.ensureDirectory(c.config, [odybo, c.base, dir]);
  let n = 0;
  for (const name of [...dirty]) {
    if (name.startsWith('prefetch-') && !c.syncPrefetch) {
      dirty.delete(name);
      continue;
    }
    const body = await buildFile(name);
    if (body) {
      await c.client.putFile(c.config, `${dir}/${name}`, JSON.stringify(body));
      n++;
    }
    dirty.delete(name);
    write(DIRTY_KEY, [...dirty]);
  }
  return n;
};

/** 第一次同步：本机已有的全部数据都算要上传（整份备份） */
const markAllOnce = async () => {
  if (read<{ at?: number } | null>(LAST_KEY, null)?.at) return;
  dirty.add('state.json');
  for (const store of [HISTORY, PREFETCH]) {
    const kind = store === HISTORY ? 'history' : 'prefetch';
    for (const r of await listAll<{ createdAt: number }>(store))
      dirty.add(`${kind}-${monthOf(r.createdAt)}.json`);
  }
  write(DIRTY_KEY, [...dirty]);
};

// ---------- 对外 ----------

export interface SyncStatus {
  at?: number;
  message: string;
}
export const lastSync = () => read<SyncStatus>(LAST_KEY, { message: '还没同步过' });

let running: Promise<SyncStatus> | null = null;
let lastPull = 0;

/** 马上同步一次：先拉别的设备的，再传本机改过的。返回结果（设置页显示）。 */
export const syncNow = (): Promise<SyncStatus> => {
  if (running) return running;
  running = (async () => {
    try {
      const c = await connect();
      if (!c) {
        return {
          message: getSettings().syncData ? 'Readest 里还没设置 WebDAV，没有同步' : '同步已关闭',
        };
      }
      lastPull = Date.now();
      await markAllOnce();
      const got = await pull(c);
      const sent = await push(c);
      const status = {
        at: Date.now(),
        message: `拉下 ${got.files} 个文件（${got.records} 条更新），传上 ${sent} 个文件`,
      };
      write(LAST_KEY, status);
      if (got.records) {
        const { remarkOpenDocs } = await import('./marks');
        remarkOpenDocs(); // 别的设备查过的词，书里也标出来
      }
      return status;
    } catch (e) {
      const status = {
        at: lastSync().at,
        message: `同步失败：${e instanceof Error ? e.message : String(e)}`,
      };
      write(LAST_KEY, status);
      return status;
    } finally {
      running = null;
    }
  })();
  return running;
};

/** 打开书、查词时调用：离上次拉超过 10 分钟才同步，否则什么都不做 */
export const syncSoon = () => {
  if (Date.now() - lastPull < PULL_EVERY_MS) return;
  void syncNow();
};
