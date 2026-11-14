import { cn } from "cn";

/** Semi Empty 的 shadcn 替代（ui-ext）：居中弱化的空态占位。项目内只用 description。 */
export function Empty({ description, className, children }: {
  description?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground", className)}>
      <svg viewBox="0 0 48 48" fill="none" className="size-10 opacity-40" aria-hidden>
        <rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M6 18h36" stroke="currentColor" strokeWidth="2" />
        <path d="M18 28h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {description && <p className="max-w-56 text-xs leading-relaxed">{description}</p>}
      {children}
    </div>
  );
}
