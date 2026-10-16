import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Flashlight, ImagePlus, ArrowLeft } from 'lucide-react';
import type { PartRecord } from '../../core/types';
import { laplacianVariance, toGray, hintFor, type Hint, type MatchResult } from '../../core/vision';
import { recordGhost } from '../drawing/model';
import { addPhoto, getRecord, saveRecord } from '../records/repo';
import { useSettings } from '../../state/settings';
import { requestMotionPermission, tiltError, useTilt } from '../../sensors/motion';
import { navigate } from '../../app/router';
import { Btn, cx, useToast } from '../../app/components/ui';
import { ghostInFrame, ghostToPhoto, viewLayout, type ViewLayout } from './layout';

type View = 'top' | 'side' | 'front';
const FRAME_W = 320;
const STABLE_MS = 400;
const SHARP_MIN = 25;
const TILT_MAX = 3;

function chime(): void {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* no audio */
  }
}

/** Guided capture with the measured shape as a ghost on the viewfinder (§10). */
export function CameraScreen({ recordId }: { recordId: string }) {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const settings = useSettings();
  const tilt = useTilt();
  const [rec, setRec] = useState<PartRecord | null>(null);
  const [view, setView] = useState<View>('top');
  const [phase, setPhase] = useState<'starting' | 'live' | 'nocam' | 'saving'>('starting');
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [green, setGreen] = useState(false);
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busy = useRef(false);
  const greenSince = useRef<number | null>(null);
  const captured = useRef(false);
  const lastMatch = useRef<MatchResult | null>(null);

  useEffect(() => {
    void getRecord(recordId).then((r) => setRec(r ?? null));
  }, [recordId]);

  const ghost = useMemo(() => (rec ? recordGhost(rec, view) : null), [rec, view]);
  const views: View[] = useMemo(
    () => (rec ? (['top', 'side', 'front'] as View[]).filter((v) => recordGhost(rec, v)) : []),
    [rec],
  );

  // Camera stream
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchOk(!!caps.torch);
        if (caps.torch && settings.torchDefault) setTorch(true);
        setPhase('live');
      } catch {
        if (!cancelled) setPhase('nocam');
      }
    })();
    return () => {
      cancelled = true;
      // Release the camera immediately when leaving the screen (§10.8).
      stream?.getTracks().forEach((tr) => tr.stop());
      trackRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !torchOk) return;
    void track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] }).catch(() => {});
  }, [torch, torchOk]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]));
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  const layout: ViewLayout | null = useMemo(() => {
    const v = videoRef.current;
    if (!ghost || !v || !v.videoWidth || !size[0]) return null;
    return viewLayout(size[0], size[1], v.videoWidth, v.videoHeight, ghost);
    // `phase` changes once the video has its size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost, size, phase]);

  // Matcher worker loop (~10–12 fps on a 320 px frame).
  useEffect(() => {
    if (phase !== 'live' || !ghost || !layout) return;
    const w = new Worker(new URL('../../workers/vision.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const v = videoRef.current!;
    const f = FRAME_W / v.videoWidth;
    const fh = Math.round(v.videoHeight * f);
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_W;
    canvas.height = fh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const pts = ghostInFrame(ghost, layout, f);
    w.onmessage = (e: MessageEvent<MatchResult>) => {
      busy.current = false;
      lastMatch.current = e.data;
      setMatch(e.data);
    };
    const timer = setInterval(() => {
      if (busy.current || v.readyState < 2) return;
      busy.current = true;
      ctx.drawImage(v, 0, 0, FRAME_W, fh);
      const img = ctx.getImageData(0, 0, FRAME_W, fh);
      w.postMessage({ id: Date.now(), w: FRAME_W, h: fh, data: img.data, ghost: pts }, [img.data.buffer]);
    }, 85);
    return () => {
      clearInterval(timer);
      w.terminate();
      workerRef.current = null;
    };
  }, [phase, ghost, layout]);

  const tErr = tiltError(tilt, view);
  const tiltOk = !tilt.live || tErr <= TILT_MAX;
  const score = match?.score ?? 0;
  const ok = score >= settings.matchThreshold && tiltOk && (match?.sharpness ?? 0) >= SHARP_MIN;
  const hint: Hint | null = match ? (ok ? 'hold' : !tiltOk ? null : hintFor(match, FRAME_W)) : null;
  const state = !match ? 'red' : ok ? (green ? 'green' : 'amber') : score >= 50 ? 'amber' : 'red';

  // Green after 400 ms stable → haptic + chime (+ auto-capture).
  useEffect(() => {
    if (!ok) {
      greenSince.current = null;
      setGreen(false);
      return;
    }
    greenSince.current ??= performance.now();
    if (!green && performance.now() - greenSince.current >= STABLE_MS) {
      setGreen(true);
      navigator.vibrate?.(30);
      chime();
      if (settings.autoCapture && !captured.current) void capture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match]);

  /** Grab a few full-resolution frames and keep the sharpest (§10.5 best frame). */
  async function capture() {
    const v = videoRef.current;
    if (!v || !rec || !ghost || !layout || captured.current) return;
    captured.current = true;
    setPhase('saving');
    const frames: { c: HTMLCanvasElement; sharp: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const x = c.getContext('2d')!;
      x.drawImage(v, 0, 0);
      const small = document.createElement('canvas');
      small.width = FRAME_W;
      small.height = Math.round((v.videoHeight * FRAME_W) / v.videoWidth);
      const sx = small.getContext('2d')!;
      sx.drawImage(c, 0, 0, small.width, small.height);
      const d = sx.getImageData(0, 0, small.width, small.height);
      frames.push({ c, sharp: laplacianVariance(toGray(d.data, small.width, small.height)) });
      await new Promise((r) => setTimeout(r, 90));
    }
    const best = frames.sort((a, b) => b.sharp - a.sharp)[0];
    const blob = await new Promise<Blob>((res) => best.c.toBlob((b) => res(b!), 'image/jpeg', 0.95));
    // Same scaling as compressImage: longest side ≤ 2048 px.
    const photoW = Math.round(best.c.width * Math.min(1, 2048 / Math.max(best.c.width, best.c.height)));
    const kp = photoW / v.videoWidth;
    const f = FRAME_W / v.videoWidth;
    const refine =
      lastMatch.current && lastMatch.current.best.score > lastMatch.current.score
        ? lastMatch.current.best
        : undefined;
    const tr = ghostToPhoto(ghost, layout, f, kp, refine);
    try {
      const r2 = await addPhoto(
        rec,
        blob,
        {
          view,
          ghostToPhoto: tr.matrix,
          mmPerPx: tr.mmPerPx,
          matchScore: Math.round(lastMatch.current?.score ?? 0),
        },
        { quality: settings.photoQuality, keepOriginal: settings.keepOriginal },
      );
      await saveRecord(r2);
      toast(t('camera.saved'));
      navigate(`/records/${rec.id}`, true);
    } catch {
      captured.current = false;
      setPhase('live');
      toast(t('save.failed'));
    }
  }

  const pickFile = async (file: File | undefined) => {
    if (!file || !rec) return;
    const r2 = await addPhoto(
      rec,
      file,
      { view },
      { quality: settings.photoQuality, keepOriginal: settings.keepOriginal },
    );
    await saveRecord(r2);
    navigate(`/align/${rec.id}/${r2.photos[r2.photos.length - 1].id}`, true);
  };

  const stroke = state === 'green' ? '#22c55e' : state === 'amber' ? '#f59e0b' : '#ef4444';

  return (
    <div className="fixed inset-0 bg-black text-white" data-testid="camera">
      <div ref={boxRef} className="absolute inset-0">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {ghost && layout && phase !== 'nocam' && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="ghost"
            data-state={state}
          >
            <g transform={`translate(${layout.cx} ${layout.cy}) scale(${layout.k})`}>
              {ghost.paths.map((p, i) =>
                p.kind === 'circle' && p.center && p.r ? (
                  <circle
                    key={i}
                    cx={p.center[0]}
                    cy={p.center[1]}
                    r={p.r}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={3 / layout.k}
                  />
                ) : (
                  <polyline
                    key={i}
                    points={[...(p.points ?? []), ...(p.closed && p.points?.length ? [p.points[0]] : [])]
                      .map((q) => q.join(','))
                      .join(' ')}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={3 / layout.k}
                    strokeLinejoin="round"
                  />
                ),
              )}
            </g>
          </svg>
        )}
      </div>

      {/* Top: back, view picker, torch */}
      <div className="chrome absolute inset-x-0 top-0 flex items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          aria-label={t('common.back')}
          className="p-2"
          onClick={() => navigate(`/records/${recordId}`)}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex rounded-xl bg-white/10 p-0.5">
          {(['top', 'side', 'front'] as View[]).map((v) => (
            <button
              key={v}
              disabled={!views.includes(v)}
              onClick={() => setView(v)}
              className={cx(
                'rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-30',
                view === v ? 'bg-sky-500' : '',
              )}
            >
              {t(`camera.view.${v}`)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {torchOk && (
          <button
            aria-label={t('camera.torch')}
            aria-pressed={torch}
            onClick={() => setTorch((x) => !x)}
            className={cx('rounded-xl p-2', torch && 'bg-amber-400 text-slate-950')}
          >
            <Flashlight size={20} />
          </button>
        )}
      </div>

      {/* Status: score, hint, tilt bubble */}
      {phase !== 'nocam' && ghost && (
        <div className="absolute inset-x-0 top-16 flex flex-col items-center gap-2">
          <div
            className={cx(
              'tabular rounded-full px-3 py-1 text-sm font-bold',
              state === 'green'
                ? 'bg-emerald-500'
                : state === 'amber'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-rose-600',
            )}
            data-testid="match-score"
          >
            {t('camera.match')} {Math.round(score)}
          </div>
          {hint && (
            <div className="rounded-xl bg-slate-950/80 px-3 py-1 text-sm">{t(`camera.hint.${hint}`)}</div>
          )}
          {!tiltOk && (
            <div className="rounded-xl bg-slate-950/80 px-3 py-1 text-sm">
              {t(view === 'top' ? 'camera.hint.flat' : 'camera.hint.upright')}
            </div>
          )}
        </div>
      )}
      {tilt.live && (
        <div
          className="absolute right-3 top-28 h-16 w-16 rounded-full border-2 border-white/60 bg-black/30"
          aria-label={t('camera.tilt')}
        >
          <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50" />
          <div
            className={cx('absolute h-3 w-3 rounded-full', tiltOk ? 'bg-emerald-400' : 'bg-amber-400')}
            style={{
              left: `calc(50% + ${Math.max(-26, Math.min(26, (view === 'top' ? tilt.gamma : tilt.gamma) * 2))}px - 6px)`,
              top: `calc(50% + ${Math.max(-26, Math.min(26, (view === 'top' ? tilt.beta : Math.abs(tilt.beta) - 90) * 2))}px - 6px)`,
            }}
          />
        </div>
      )}

      {phase === 'nocam' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center"
          data-testid="camera-fallback"
        >
          <Camera size={42} className="text-slate-400" />
          <p className="text-sm text-slate-300">{t('camera.noCamera')}</p>
        </div>
      )}
      {!ghost && rec && (
        <div className="absolute inset-x-6 top-1/3 rounded-xl bg-slate-900/90 p-4 text-center text-sm">
          {t('camera.noGhost')}
        </div>
      )}

      {/* Bottom: gallery, shutter */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-around pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        <label
          className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-white/15"
          aria-label={t('camera.gallery')}
        >
          <ImagePlus size={22} />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            data-testid="camera-file"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </label>
        <button
          aria-label={t('camera.shutter')}
          disabled={phase !== 'live' || !ghost}
          onClick={() => void capture()}
          className={cx(
            'h-20 w-20 rounded-full border-4 disabled:opacity-40',
            state === 'green' ? 'border-emerald-400 bg-emerald-500/40' : 'border-white bg-white/20',
          )}
        />
        <Btn
          variant="ghost"
          className="h-12 w-12 px-0 text-[11px]"
          onClick={() => {
            void requestMotionPermission();
            settings.set({ autoCapture: !settings.autoCapture });
          }}
        >
          {settings.autoCapture ? 'AUTO' : 'MAN'}
        </Btn>
      </div>
    </div>
  );
}
