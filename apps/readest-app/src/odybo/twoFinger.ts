// 两指轻点呼出 / 收起菜单（开着「单击查词」时才有）：单击查词占了轻点单词，正文里空白不多，呼出菜单改用两个手指同时点一下。
// 两个手指放下、几乎不动、很快抬起，就当作点了一下屏幕中间：切换顶部和底部工具栏（和 Readest 点中间一样）。
// 捏合缩放手指会移动，不算。接入点：app/reader/utils/iframeEventHandlers.ts 的 handleTouchEv 开头调用 odyboTwoFingerTap。
import { getSettings } from './settings';

const MOVE_PX = 12; // 手指移动超过这么多就不算轻点
const MAX_MS = 400; // 两指都放下后，多久内抬起才算轻点

interface Tap {
  start: number;
  pts: Map<number, { x: number; y: number }>;
  moved: boolean;
}
const taps = new Map<string, Tap>();

export const odyboTwoFingerTap = (bookKey: string, event: TouchEvent, type: string) => {
  if (!getSettings().tapLookup) return;
  if (type === 'iframe-touchstart') {
    if (event.touches.length === 2) {
      const pts = new Map<number, { x: number; y: number }>();
      for (const t of Array.from(event.touches))
        pts.set(t.identifier, { x: t.screenX, y: t.screenY });
      taps.set(bookKey, { start: event.timeStamp, pts, moved: false });
    } else {
      taps.delete(bookKey); // 一个手指（还没放第二个），或者三个以上
    }
  } else if (type === 'iframe-touchmove') {
    const tap = taps.get(bookKey);
    if (!tap) return;
    for (const t of Array.from(event.touches)) {
      const p = tap.pts.get(t.identifier);
      if (p && Math.hypot(t.screenX - p.x, t.screenY - p.y) > MOVE_PX) tap.moved = true;
    }
  } else if (type === 'iframe-touchend') {
    const tap = taps.get(bookKey);
    if (!tap || event.touches.length > 0) return; // 等两个手指都抬起
    taps.delete(bookKey);
    if (tap.moved || event.timeStamp - tap.start > MAX_MS) return;
    void toggleBars(bookKey);
  } else if (type === 'iframe-touchcancel') {
    taps.delete(bookKey);
  }
};

// 用到时再加载状态库（见 vocabLink.ts 的说明）
const toggleBars = async (bookKey: string) => {
  const { useReaderStore } = await import('@/store/readerStore');
  const st = useReaderStore.getState();
  st.setHoveredBookKey(st.hoveredBookKey ? null : bookKey);
};
