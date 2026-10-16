import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Caliper-style thumb wheel (§6.2, §7.2): dragging sideways turns it in detents; each detent moves the
 * selected tool's main feature by 1 device px or 0.05 mm (Settings → Nudge step), with a haptic tick.
 */
export function ThumbWheel({ onDetents, onEnd }: { onDetents: (n: number) => void; onEnd: () => void }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const st = useRef<{ id: number; x: number; acc: number } | null>(null);
  const DETENT_PX = 9;
  return (
    <div className="flex items-center justify-center gap-2 px-2 pb-1">
      <div
        role="slider"
        aria-label={t('wheel.label')}
        aria-valuenow={0}
        tabIndex={0}
        data-testid="thumb-wheel"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onDetents(1);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onDetents(-1);
          else return;
          e.preventDefault();
          onEnd();
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          st.current = { id: e.pointerId, x: e.clientX, acc: 0 };
        }}
        onPointerMove={(e) => {
          const s = st.current;
          if (!s || s.id !== e.pointerId) return;
          s.acc += e.clientX - s.x;
          s.x = e.clientX;
          const n = Math.trunc(s.acc / DETENT_PX);
          if (n !== 0) {
            s.acc -= n * DETENT_PX;
            onDetents(n);
            setOffset((o) => o + n * DETENT_PX);
          }
        }}
        onPointerUp={() => {
          st.current = null;
          onEnd();
        }}
        onPointerCancel={() => {
          st.current = null;
          onEnd();
        }}
        className="h-10 w-[min(70vw,260px)] cursor-ew-resize touch-none rounded-full border border-white/20 shadow-inner"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent 35%, transparent 65%, rgba(0,0,0,0.55)), repeating-linear-gradient(90deg, #94a3b8 0 2px, #475569 2px 9px)',
          backgroundPosition: `0 0, ${offset}px 0`,
        }}
      />
      <span className="text-[10px] font-semibold text-slate-400">{t('wheel.hint')}</span>
    </div>
  );
}
