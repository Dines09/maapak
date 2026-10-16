import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Btn({
  variant = 'default',
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-40',
        variant === 'primary' && 'bg-sky-500 text-white hover:bg-sky-400',
        variant === 'default' && 'bg-slate-700/80 text-slate-50 hover:bg-slate-600',
        variant === 'ghost' && 'bg-transparent text-slate-100 hover:bg-white/10',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-500',
        className,
      )}
    />
  );
}

export function IconBtn({
  label,
  active,
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...p}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-xl text-slate-100 transition active:scale-95 disabled:opacity-35',
        active ? 'bg-sky-500/90 text-white' : 'hover:bg-white/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Bottom sheet dialog. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        data-testid={testId}
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-slate-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-slate-100 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <IconBtn label="Close" onClick={onClose}>
            <X size={20} />
          </IconBtn>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 py-1">
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-slate-600 transition peer-checked:bg-sky-500 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-300 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-slate-800/90 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[10px] font-semibold transition',
            size === 'sm' ? 'min-h-9 px-2.5 text-xs' : 'min-h-10 px-3 text-sm',
            o.value === value ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 block text-xs font-semibold text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3 text-base text-slate-50 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl bg-slate-800/60 p-3">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-300">{title}</h3>
      {children}
    </section>
  );
}

// ---------- toasts ----------

interface ToastStore {
  msg: string | null;
  show(msg: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastStore>((set) => ({
  msg: null,
  show(msg) {
    set({ msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ msg: null }), 2600);
  },
}));

export function Toaster() {
  const msg = useToast((s) => s.msg);
  if (!msg) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center px-4">
      <div className="rounded-xl bg-slate-950/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
        {msg}
      </div>
    </div>
  );
}

export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-slate-950/95 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
      <IconBtn label="Back" onClick={onBack}>
        <span aria-hidden className="text-xl">
          ←
        </span>
      </IconBtn>
      <h1 className="flex-1 truncate text-lg font-bold">{title}</h1>
      {right}
    </header>
  );
}
