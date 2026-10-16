// Level & inclinometer (§6.9): bullseye (phone flat on a surface) and tube / angle finder (phone standing on
// an edge). Readouts in degrees, % slope, mm per metre and 1:x; hold, relative zero, two-position reversal
// calibration, editable slope presets, sound / haptic when on target.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  LevelFilter,
  edgeAngle,
  fromNearestAxis,
  reversalOffset,
  slopeMmPerM,
  slopePct,
  slopeRatio,
  surfaceTilt,
} from '../../core/level';
import { formatNumber } from '../../core/units';
import { requestGravityPermission, useGravity } from '../../sensors/gravity';
import { navigate } from '../../app/router';
import { Btn, ScreenHeader, Segmented, cx, inputCls } from '../../app/components/ui';

type Mode = 'surface' | 'edge';
const ON_TARGET = 0.1; // deg
const DEFAULT_SLOPES = ['0°', '1%', '2%', '1:12', '5°', '30°', '45°'];

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

/** "2%", "1:12", "5°" → degrees (null when not understood). */
export function parseSlope(s: string): number | null {
  const t = s.trim().replace(',', '.');
  let m = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) return (Math.atan(Number(m[1]) / 100) * 180) / Math.PI;
  m = /^1\s*:\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m && Number(m[1]) > 0) return (Math.atan(1 / Number(m[1])) * 180) / Math.PI;
  m = /^(-?\d+(?:\.\d+)?)\s*°?$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

let audio: AudioContext | null = null;
function beep(): void {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const gn = audio.createGain();
    o.frequency.value = 1320;
    gn.gain.setValueAtTime(0.12, audio.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    o.connect(gn).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.13);
  } catch {
    /* no audio */
  }
}

export function LevelScreen() {
  const { t } = useTranslation();
  const grav = useGravity();
  const [mode, setMode] = useState<Mode>(() => store.get<Mode>('maapak.level.mode', 'surface'));
  const [held, setHeld] = useState<[number, number] | null>(null);
  const [zero, setZero] = useState<[number, number]>([0, 0]);
  const [bias, setBias] = useState<Record<Mode, [number, number]>>(() =>
    store.get('maapak.level.bias', { surface: [0, 0], edge: [0, 0] }),
  );
  const [cal, setCal] = useState<{ step: 1 | 2; first?: [number, number] } | null>(null);
  const [sound, setSound] = useState(() => store.get('maapak.level.sound', true));
  const [slopes, setSlopes] = useState<string[]>(() => store.get('maapak.level.slopes', DEFAULT_SLOPES));
  const [target, setTarget] = useState<string>('0°');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [askPerm, setAskPerm] = useState(false);

  useEffect(() => store.set('maapak.level.mode', mode), [mode]);
  useEffect(() => store.set('maapak.level.sound', sound), [sound]);
  useEffect(() => store.set('maapak.level.slopes', slopes), [slopes]);
  useEffect(() => store.set('maapak.level.bias', bias), [bias]);
  useEffect(() => {
    const id = setTimeout(() => setAskPerm(!grav.live), 900);
    return () => clearTimeout(id);
  }, [grav.live]);

  // Filtered raw angles: surface → (roll, pitch); edge → (edge angle, 0).
  const fx = useRef(new LevelFilter());
  const fy = useRef(new LevelFilter());
  const raw = useMemo<[number, number]>(() => {
    if (mode === 'surface') {
      const [r, p] = surfaceTilt(grav.up);
      return [fx.current.push(r, null, grav.dt), fy.current.push(p, null, grav.dt)];
    }
    return [fx.current.push(edgeAngle(grav.up), grav.rateZ, grav.dt), 0];
  }, [grav, mode]);
  useEffect(() => {
    fx.current.reset();
    fy.current.reset();
  }, [mode]);

  const b = bias[mode];
  const live: [number, number] = [raw[0] - b[0] - zero[0], raw[1] - b[1] - zero[1]];
  const [vx, vy] = held ?? live;

  // Main value: edge → deviation of the resting edge from horizontal; surface → total tilt.
  const edge = fromNearestAxis(vx);
  const main = mode === 'edge' ? edge.deviation : Math.hypot(vx, vy);
  const tgt = parseSlope(target) ?? 0;
  const delta = Math.abs(main) - tgt;
  const onTarget = grav.live && Math.abs(delta) < ON_TARGET;
  const was = useRef(false);
  useEffect(() => {
    if (onTarget && !was.current && grav.live && !held) {
      if (sound) beep();
      navigator.vibrate?.(30);
    }
    was.current = onTarget;
  }, [onTarget, sound, grav.live, held]);

  const doZero = () => {
    if (zero[0] || zero[1]) setZero([0, 0]);
    else setZero([raw[0] - b[0], raw[1] - b[1]]);
  };
  const doCal = () => {
    if (!cal) return setCal({ step: 1 });
    if (cal.step === 1) return setCal({ step: 2, first: [raw[0], raw[1]] });
    const f = cal.first!;
    // Edge readings near ±180° are compared through their deviation from the nearest axis.
    const dev = (a: number) => (mode === 'edge' ? fromNearestAxis(a).deviation : a);
    setBias({ ...bias, [mode]: [reversalOffset(dev(f[0]), dev(raw[0])), reversalOffset(f[1], raw[1])] });
    setZero([0, 0]);
    setCal(null);
  };

  const fmt = (d: number) => formatNumber(d, 1);
  const ratio = slopeRatio(main);
  const BUB = 10; // deg at the rim

  return (
    <div
      className={cx(
        'min-h-dvh text-slate-100 transition-colors',
        onTarget ? 'bg-emerald-950' : 'bg-slate-950',
      )}
    >
      <ScreenHeader
        title={t('tool.level')}
        onBack={() => navigate('/')}
        right={
          <button
            className="px-2 text-xs text-slate-300"
            onClick={() => setSound((s) => !s)}
            data-testid="level-sound"
          >
            {sound ? t('level.soundOn') : t('level.soundOff')}
          </button>
        }
      />
      <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pb-10">
        <Segmented
          label={t('level.mode')}
          value={mode}
          onChange={(m) => setMode(m)}
          options={[
            { value: 'surface', label: t('level.surface') },
            { value: 'edge', label: t('level.edge') },
          ]}
        />

        {askPerm && (
          <Btn
            variant="primary"
            data-testid="level-permission"
            onClick={() => void requestGravityPermission().then((ok) => setAskPerm(!ok))}
          >
            {t('level.enable')}
          </Btn>
        )}

        <div className="flex justify-center" data-testid="level-visual">
          {mode === 'surface' ? (
            <svg viewBox="-110 -110 220 220" width="240" height="240" aria-hidden>
              <circle r="104" fill="#0f172a" stroke="#334155" strokeWidth="2" />
              {[1, 2, 5].map((d) => (
                <circle key={d} r={(d / BUB) * 100} fill="none" stroke="#475569" strokeWidth="1" />
              ))}
              <path d="M-104 0H104M0 -104V104" stroke="#334155" strokeWidth="1" />
              <circle
                cx={Math.max(-1, Math.min(1, vx / BUB)) * 92}
                cy={Math.max(-1, Math.min(1, -vy / BUB)) * 92}
                r="12"
                fill={onTarget ? '#34d399' : '#facc15'}
                opacity="0.9"
              />
            </svg>
          ) : (
            <svg viewBox="-150 -40 300 80" width="300" height="80" aria-hidden>
              <rect
                x="-140"
                y="-22"
                width="280"
                height="44"
                rx="22"
                fill="#0f172a"
                stroke="#334155"
                strokeWidth="2"
              />
              <path d="M-16 -22V22M16 -22V22" stroke="#64748b" strokeWidth="1.5" />
              <ellipse
                cx={Math.max(-1, Math.min(1, -edge.deviation / BUB)) * 118}
                cy="0"
                rx="18"
                ry="13"
                fill={onTarget ? '#34d399' : '#facc15'}
                opacity="0.9"
              />
            </svg>
          )}
        </div>

        <div className="text-center" data-testid="level-readout">
          <div className="tabular text-6xl font-bold tracking-tight">
            {fmt(main)}
            <span className="text-3xl text-slate-400">°</span>
          </div>
          <div className="tabular mt-1 text-sm text-slate-300">
            {formatNumber(slopePct(Math.abs(main)), 2)} % · {formatNumber(slopeMmPerM(Math.abs(main)), 1)}{' '}
            mm/m · 1:
            {Number.isFinite(ratio) ? formatNumber(ratio, ratio > 100 ? 0 : 1) : '∞'}
          </div>
          {mode === 'surface' ? (
            <div className="tabular mt-0.5 text-xs text-slate-400">
              X {fmt(vx)}° · Y {fmt(vy)}°
            </div>
          ) : (
            <div className="tabular mt-0.5 text-xs text-slate-400">
              {t(edge.axis % 180 === 0 ? 'level.shortEdge' : 'level.longEdge')} · {t('level.fromVertical')}{' '}
              {fmt(90 - Math.abs(edge.deviation))}°
            </div>
          )}
          {tgt !== 0 && (
            <div
              className={cx(
                'tabular mt-1 text-sm font-semibold',
                onTarget ? 'text-emerald-300' : 'text-amber-300',
              )}
            >
              {t('level.target')} {target} ({fmt(tgt)}°) · Δ {delta >= 0 ? '+' : ''}
              {formatNumber(delta, 2)}°
            </div>
          )}
          {grav.source === 'orientation' && (
            <div className="mt-1 text-[11px] text-slate-500">{t('level.fallback')}</div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Btn
            data-testid="level-hold"
            variant={held ? 'primary' : 'default'}
            onClick={() => setHeld((h) => (h ? null : live))}
          >
            {held ? t('level.release') : 'HOLD'}
          </Btn>
          <Btn data-testid="level-zero" variant={zero[0] || zero[1] ? 'primary' : 'default'} onClick={doZero}>
            {zero[0] || zero[1] ? 'ABS' : 'ZERO'}
          </Btn>
          <Btn data-testid="level-cal" variant={cal ? 'primary' : 'default'} onClick={doCal}>
            {cal ? t('level.capture', { n: cal.step }) : t('level.calibrate')}
          </Btn>
        </div>
        {cal && (
          <p className="rounded-xl bg-slate-800 p-2 text-xs text-slate-200" data-testid="level-cal-hint">
            {t(cal.step === 1 ? 'level.cal1' : 'level.cal2')}{' '}
            <button className="ml-1 underline" onClick={() => setCal(null)}>
              {t('common.cancel')}
            </button>
          </p>
        )}
        {(bias[mode][0] !== 0 || bias[mode][1] !== 0) && !cal && (
          <p className="tabular text-center text-[11px] text-slate-500">
            {t('level.biasInfo', {
              v: fmt(bias[mode][0]) + (mode === 'surface' ? ` / ${fmt(bias[mode][1])}` : ''),
            })}{' '}
            <button className="underline" onClick={() => setBias({ ...bias, [mode]: [0, 0] })}>
              {t('level.clearCal')}
            </button>
          </p>
        )}

        <section>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('level.presets')}</h2>
            <button className="text-xs text-sky-300" onClick={() => setEditing((e) => !e)}>
              {editing ? t('common.done') : t('common.edit')}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {slopes.map((s) => (
              <span key={s} className="flex items-center">
                <button
                  data-testid={`slope-${s}`}
                  onClick={() => setTarget(s)}
                  className={cx(
                    'tabular min-h-9 rounded-lg px-3 text-sm font-semibold',
                    target === s ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-200',
                  )}
                >
                  {s}
                </button>
                {editing && (
                  <button
                    aria-label={t('common.delete')}
                    className="p-1 text-slate-400"
                    onClick={() => setSlopes(slopes.filter((x) => x !== s))}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            ))}
          </div>
          {editing && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (parseSlope(v) !== null && !slopes.includes(v)) setSlopes([...slopes, v]);
                setDraft('');
              }}
            >
              <input
                className={inputCls}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="2% · 1:50 · 3.5°"
              />
              <Btn type="submit">{t('common.add')}</Btn>
            </form>
          )}
        </section>

        <p className="text-xs leading-relaxed text-slate-500">{t('level.note')}</p>
      </main>
    </div>
  );
}
