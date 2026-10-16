import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check } from 'lucide-react';
import type { PartRecord, PhotoRef } from '../../core/types';
import { recordGhost } from '../drawing/model';
import { similarity } from '../drawing/annotate';
import { getRecord, photoUrl, saveRecord } from '../records/repo';
import { navigate } from '../../app/router';
import { Btn, useToast } from '../../app/components/ui';

interface T {
  /** Ghost origin in photo px. */
  tx: number;
  ty: number;
  /** Photo px per mm. */
  k: number;
  rot: number;
}

/** Gallery fallback (§10.7): align the ghost on a photo by hand — same scale-locked result. */
export function AlignScreen({ recordId, photoId }: { recordId: string; photoId: string }) {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const [rec, setRec] = useState<PartRecord | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [tr, setTr] = useState<T | null>(null);
  const [disp, setDisp] = useState({ s: 1, ox: 0, oy: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, [number, number]>());
  const start = useRef<{ tr: T; pts: [number, number][] } | null>(null);

  const photo: PhotoRef | undefined = rec?.photos.find((p) => p.id === photoId);
  const ghost = useMemo(
    () =>
      rec ? recordGhost(rec, photo?.view === 'side' || photo?.view === 'front' ? photo.view : 'top') : null,
    [rec, photo],
  );

  useEffect(() => {
    void getRecord(recordId).then((r) => setRec(r ?? null));
  }, [recordId]);

  useEffect(() => {
    if (!photo) return;
    let u: string | null = null;
    void photoUrl(photo.blobKey).then((x) => {
      u = x;
      setUrl(x);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [photo]);

  // Display mapping (contain) and initial ghost placement.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !photo) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / photo.width, r.height / photo.height);
      setDisp({ s, ox: (r.width - photo.width * s) / 2, oy: (r.height - photo.height * s) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [photo]);

  useEffect(() => {
    if (!photo || !ghost || tr) return;
    if (photo.ghostToPhoto) {
      const m = photo.ghostToPhoto;
      setTr({ tx: m[2], ty: m[5], k: Math.hypot(m[0], m[3]), rot: (Math.atan2(m[3], m[0]) * 180) / Math.PI });
      return;
    }
    const [x0, y0, x1, y1] = ghost.boundsMm;
    const k = 0.6 * Math.min(photo.width / (x1 - x0), photo.height / (y1 - y0));
    setTr({ tx: photo.width / 2, ty: photo.height / 2, k, rot: 0 });
  }, [photo, ghost, tr]);

  const toPhoto = (x: number, y: number): [number, number] => [
    (x - disp.ox) / disp.s,
    (y - disp.oy) / disp.s,
  ];

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = boxRef.current!.getBoundingClientRect();
    ptrs.current.set(e.pointerId, toPhoto(e.clientX - r.left, e.clientY - r.top));
    if (tr) start.current = { tr, pts: [...ptrs.current.values()] };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !start.current) return;
    const r = boxRef.current!.getBoundingClientRect();
    ptrs.current.set(e.pointerId, toPhoto(e.clientX - r.left, e.clientY - r.top));
    const now = [...ptrs.current.values()];
    const s0 = start.current;
    if (now.length === 1 && s0.pts.length === 1) {
      setTr({ ...s0.tr, tx: s0.tr.tx + now[0][0] - s0.pts[0][0], ty: s0.tr.ty + now[0][1] - s0.pts[0][1] });
    } else if (now.length >= 2 && s0.pts.length >= 2) {
      // Two fingers: pinch scales, twist rotates, midpoint moves.
      const d0 = Math.hypot(s0.pts[1][0] - s0.pts[0][0], s0.pts[1][1] - s0.pts[0][1]) || 1;
      const d1 = Math.hypot(now[1][0] - now[0][0], now[1][1] - now[0][1]) || 1;
      const a0 = Math.atan2(s0.pts[1][1] - s0.pts[0][1], s0.pts[1][0] - s0.pts[0][0]);
      const a1 = Math.atan2(now[1][1] - now[0][1], now[1][0] - now[0][0]);
      const m0 = [(s0.pts[0][0] + s0.pts[1][0]) / 2, (s0.pts[0][1] + s0.pts[1][1]) / 2];
      const m1 = [(now[0][0] + now[1][0]) / 2, (now[0][1] + now[1][1]) / 2];
      setTr({
        k: s0.tr.k * (d1 / d0),
        rot: s0.tr.rot + ((a1 - a0) * 180) / Math.PI,
        tx: s0.tr.tx + m1[0] - m0[0],
        ty: s0.tr.ty + m1[1] - m0[1],
      });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    start.current = tr ? { tr, pts: [...ptrs.current.values()] } : null;
  };

  const save = async () => {
    if (!rec || !photo || !tr) return;
    const updated: PartRecord = {
      ...rec,
      photos: rec.photos.map((p) =>
        p.id === photo.id
          ? { ...p, ghostToPhoto: similarity(tr.k, tr.rot, tr.tx, tr.ty), mmPerPx: 1 / tr.k }
          : p,
      ),
    };
    await saveRecord(updated);
    toast(t('camera.aligned'));
    navigate(`/records/${rec.id}`, true);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950 text-white" data-testid="align">
      <div className="flex items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          aria-label={t('common.back')}
          className="p-2"
          onClick={() => navigate(`/records/${recordId}`)}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="flex-1 text-base font-bold">{t('camera.alignTitle')}</h1>
        <Btn variant="primary" className="min-h-10" onClick={() => void save()} data-testid="align-save">
          <Check size={18} /> {t('common.save')}
        </Btn>
      </div>
      <p className="px-3 pb-2 text-xs text-slate-400">{t('camera.alignHint')}</p>
      <div
        ref={boxRef}
        className="relative flex-1 touch-none overflow-hidden"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {url && photo && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute select-none"
            style={{
              left: disp.ox,
              top: disp.oy,
              width: photo.width * disp.s,
              height: photo.height * disp.s,
            }}
          />
        )}
        {ghost && tr && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <g
              transform={`translate(${disp.ox} ${disp.oy}) scale(${disp.s}) translate(${tr.tx} ${tr.ty}) rotate(${tr.rot}) scale(${tr.k})`}
            >
              {ghost.paths.map((p, i) =>
                p.kind === 'circle' && p.center && p.r ? (
                  <circle
                    key={i}
                    cx={p.center[0]}
                    cy={p.center[1]}
                    r={p.r}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={2.5 / (tr.k * disp.s)}
                  />
                ) : (
                  <polyline
                    key={i}
                    points={[...(p.points ?? []), ...(p.closed && p.points?.length ? [p.points[0]] : [])]
                      .map((q) => q.join(','))
                      .join(' ')}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={2.5 / (tr.k * disp.s)}
                  />
                ),
              )}
            </g>
          </svg>
        )}
      </div>
      {tr && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-xs">
          <span>{t('camera.scale')}</span>
          <div className="flex gap-1">
            {[-5, -1, 1, 5].map((d) => (
              <button
                key={d}
                className="min-h-9 flex-1 rounded-lg bg-white/10 font-bold"
                onClick={() => setTr({ ...tr, k: tr.k * (1 + d / 100) })}
              >
                {d > 0 ? `+${d}` : d}%
              </button>
            ))}
          </div>
          <span>{t('camera.rotation')}</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={0.5}
            value={tr.rot}
            onChange={(e) => setTr({ ...tr, rot: Number(e.target.value) })}
          />
        </div>
      )}
    </div>
  );
}
