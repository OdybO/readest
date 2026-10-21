// 本机数据改了（查词记录、预读结果、生词的移出和忽略、我们的设置），通知同步（dataSync.ts）过一会儿上传到 WebDAV。
// 单独一个小文件，history.ts、vocab.ts、settings.ts 都能引用，不会和 dataSync.ts 互相引用。
// 从 WebDAV 拉下来的数据写进本机时不通知（各处的 silent 参数），免得刚拉下来又传上去。

export interface Change {
  /** history = 查词记录，prefetch = 预读结果，state = 生词的移出和忽略、设置 */
  kind: 'history' | 'prefetch' | 'state';
  /** 记录的时间（按月份分文件用） */
  at?: number;
}

const listeners = new Set<(c: Change) => void>();

export const onChange = (fn: (c: Change) => void) => {
  listeners.add(fn);
};

export const notifyChange = (c: Change) => {
  for (const fn of listeners) {
    try {
      fn(c);
    } catch (e) {
      console.warn('[odybo] 通知同步失败', e);
    }
  }
};
