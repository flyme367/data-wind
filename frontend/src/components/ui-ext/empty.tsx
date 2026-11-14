import { Empty as EmptyPrimitive, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";
import { cn } from "cn";

/** Semi Empty 的替代（ui-ext）：项目内只用 description，内部组合官方 Empty 组件（skill 规范：空态用 Empty 不自绘）。 */
export function Empty({ description, className, children }: {
  description?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <EmptyPrimitive className={cn("gap-2 p-8", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <svg viewBox="0 0 48 48" fill="none" aria-hidden>
            <rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M6 18h36" stroke="currentColor" strokeWidth="2" />
            <path d="M18 28h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </EmptyMedia>
        {description && <EmptyDescription className="max-w-56 text-xs leading-relaxed">{description}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </EmptyPrimitive>
  );
}
