"use client";

import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";

type LiveCtx = { paused: boolean; setPaused: (p: boolean) => void };
const LiveContext = createContext<LiveCtx>({ paused: false, setPaused: () => {} });
export const useLive = () => useContext(LiveContext);

type Tone = "info" | "success" | "error" | "progress";
type Toast = { id: number; title: string; body?: string; tone: Tone };
type ToastInput = { title: string; body?: string; tone?: Tone; id?: number; sticky?: boolean };
type ToastCtx = { toast: (t: ToastInput) => number; dismiss: (id: number) => void };
const ToastContext = createContext<ToastCtx>({ toast: () => 0, dismiss: () => {} });
export const useToast = () => useContext(ToastContext);

type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmContext = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
/** Ask before destructive or far-reaching actions. Resolves true if confirmed. */
export const useConfirm = () => useContext(ConfirmContext);

let nextId = 1;

export function Providers({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  /** Show a toast, or update an existing one when `id` is given. */
  const toast = useCallback<ToastCtx["toast"]>(
    (t) => {
      const id = t.id ?? nextId++;
      const next: Toast = { id, title: t.title, body: t.body, tone: t.tone ?? "info" };
      setToasts((ts) => (ts.some((x) => x.id === id) ? ts.map((x) => (x.id === id ? next : x)) : [...ts.slice(-3), next]));
      clearTimeout(timers.current.get(id));
      if (!t.sticky && next.tone !== "progress") timers.current.set(id, setTimeout(() => dismiss(id), next.tone === "error" ? 9000 : 5000));
      return id;
    },
    [dismiss],
  );

  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <LiveContext.Provider value={{ paused, setPaused }}>
      <ToastContext.Provider value={{ toast, dismiss }}>
        <ConfirmContext.Provider value={ask}>
          {children}

          {confirm && (
            <Modal title={confirm.title} onClose={() => close(false)} icon={confirm.danger ? TriangleAlert : undefined} danger={confirm.danger}>
              {confirm.body && <div className="text-sm text-muted">{confirm.body}</div>}
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button variant={confirm.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                  {confirm.confirmLabel ?? "Confirm"}
                </Button>
              </div>
            </Modal>
          )}

          <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6">
            {toasts.map((t) => (
              <div key={t.id} className="glass glass-strong pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl p-3.5 shadow-2xl [animation:toast-in_.2s_ease-out]">
                {t.tone === "success" ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />
                ) : t.tone === "error" ? (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-crit" />
                ) : t.tone === "progress" ? (
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary-fg" />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-primary-fg" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.body && <p className="mt-0.5 line-clamp-4 text-xs break-words whitespace-pre-line text-muted">{t.body}</p>}
                </div>
                <button onClick={() => dismiss(t.id)} className="rounded-md p-0.5 text-subtle hover:text-fg" aria-label="Dismiss notification">
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </ConfirmContext.Provider>
      </ToastContext.Provider>
    </LiveContext.Provider>
  );
}

export function Modal({
  title,
  onClose,
  children,
  icon: Icon,
  danger,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  icon?: typeof Info;
  danger?: boolean;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[65] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("glass glass-strong relative max-h-[90dvh] w-full overflow-y-auto rounded-2xl p-6 shadow-2xl scrollbar-thin [animation:toast-in_.15s_ease-out]", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="mb-3 flex items-start gap-3">
          {Icon && (
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", danger ? "bg-crit/15 text-crit" : "bg-primary-soft text-primary-fg")}>
              <Icon className="size-5" />
            </span>
          )}
          <h2 className="flex-1 pt-1.5 text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-subtle hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
