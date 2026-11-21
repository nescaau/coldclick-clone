'use client';

/**
 * Primitivos de UI — classes e medidas idênticas às da plataforma de referência
 * (botões min-h-11, raio md=10px, cartões rounded-2xl=20px, pílulas 12px/semibold…).
 */
import { CheckCircle2, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

// Reexportado por conveniência nos componentes de cliente; Server Components devem importar de '@/lib/cn'.
export { cn };

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'danger' | 'link';
type ButtonSize = 'default' | 'sm' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-primary hover:bg-primary/90',
  secondary: 'bg-secondary text-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-background text-foreground hover:bg-secondary/60',
  ghost: 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
  destructive: 'text-destructive hover:bg-destructive/10',
  /** Ação destrutiva confirmada (botão vermelho cheio). */
  danger: 'bg-destructive text-white hover:bg-destructive/90',
  link: 'text-link hover:underline',
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: 'min-h-11 px-4 py-2',
  sm: 'min-h-9 px-3 py-1.5',
  icon: 'size-11',
};

/** Classes de botão — usadas também por <Link> para links com aparência de botão. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'default', extra?: string): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    extra,
  );
}

export function Button({
  variant = 'secondary',
  size = 'default',
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button {...rest} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'secondary',
  size = 'default',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...rest} className={buttonClass(variant, size, className)} />;
}

/* ---------- Layout ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl bg-card', className)}>{children}</div>;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-muted-foreground">{children}</div>}
    </div>
  );
}

/* ---------- Feedback ---------- */

type Tone = 'neutral' | 'success' | 'warning' | 'destructive' | 'primary';
const TONES: Record<Tone, string> = {
  neutral: 'bg-secondary text-foreground',
  success: 'bg-success/[0.14] text-success',
  warning: 'bg-warning/[0.14] text-warning',
  destructive: 'bg-destructive text-white dark:bg-destructive/60',
  primary: 'bg-primary/[0.14] text-link',
};

/** Pílula de status (12px, semibold, totalmente arredondada). */
export function Pill({ tone = 'neutral', size = 'sm', className, children }: { tone?: Tone; size?: 'sm' | 'md'; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold',
        size === 'md' ? 'text-[13px] leading-[18px]' : 'text-xs',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({ tone = 'destructive', children }: { tone?: 'destructive' | 'warning' | 'primary' | 'success'; children: ReactNode }) {
  const styles = {
    destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
    warning: 'border-warning/40 bg-warning/10 text-warning',
    primary: 'border-primary/40 bg-primary/10 text-link',
    success: 'border-success/40 bg-success/10 text-success',
  };
  return <div className={cn('rounded-lg border px-3 py-2 text-sm', styles[tone])}>{children}</div>;
}

/** Barra de progresso: trilho primary/20, preenchimento primary, 8px de altura. */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-primary/20"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${value}%` }} />
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('size-4 animate-spin', className)} />;

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton rounded-2xl bg-accent', className)} />;

/** Interruptor (role="switch") — "Usar na rotação". */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-secondary',
      )}
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-foreground shadow transition-transform',
          checked ? 'translate-x-[calc(100%-2px)]' : 'translate-x-0',
        )}
      />
    </button>
  );
}

/* ---------- Formulários ---------- */

/** Grupo de opções exclusivas em botões (radiogroup): idioma do vídeo, modo dos eixos de variação… */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  compact,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-xl text-sm font-semibold transition-colors',
            compact ? 'min-h-9 px-3' : 'min-h-11 px-4',
            value === o.id ? 'bg-primary text-primary-foreground shadow-primary' : 'bg-accent/35 text-foreground hover:bg-accent/60',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  size = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn('my-8 w-full rounded-2xl border border-border bg-card shadow-2xl', size === 'lg' ? 'max-w-3xl' : 'max-w-xl')}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Diálogo de confirmação ---------- */

/** Diálogo (role="alertdialog") de confirmação: "Voltar/Enviar…", "Manter avatar/Remover avatar". */
export function ConfirmDialog({
  open,
  title,
  children,
  cancelLabel,
  confirmLabel,
  tone = 'primary',
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !loading && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={() => !loading && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[28rem] rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-foreground/90">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Toasts (canto inferior direito, como o sonner da referência) ---------- */

interface ToastItem {
  id: number;
  message: string;
}
const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, message }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <section aria-label="Notifications alt+T" tabIndex={-1} className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium shadow-xl"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{t.message}</span>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

/* ---------- Datas ---------- */

/**
 * Data formatada no fuso do navegador. `suppressHydrationWarning` evita aviso, pois o servidor
 * (fuso diferente) renderiza um texto e o cliente corrige logo após hidratar.
 */
export function DateText({ iso, withTime = true, seconds = false }: { iso: string | null; withTime?: boolean; seconds?: boolean }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  const text = withTime
    ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: seconds ? 'medium' : 'short' })
    : d.toLocaleDateString('pt-BR');
  return <span suppressHydrationWarning>{text}</span>;
}
