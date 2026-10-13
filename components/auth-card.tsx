import type { ReactNode } from "react";

/** Centered glass card used by sign-in, setup and invite pages. */
export function AuthCard({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_8px_28px_-8px_var(--primary-ring)]">
            <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 17l6-6-6-6" />
              <path d="M12 19h8" />
            </svg>
          </span>
          <span className="text-lg font-semibold tracking-tight">Orbit</span>
        </div>
        <section className="glass p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{children}</p>;
}
