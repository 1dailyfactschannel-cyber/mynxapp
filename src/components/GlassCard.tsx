import { type ReactNode, type MouseEventHandler, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

/** Стеклянная карточка; прокидывает любые div-атрибуты
 *  (нужно, например, для нативного drag&drop вложений) */
export function GlassCard({ children, className, hover = false, onClick, ...rest }: GlassCardProps) {
  return (
    <div className={cn("glass-card", hover && "hoverable", className)} onClick={onClick} {...rest}>
      {children}
    </div>
  );
}
