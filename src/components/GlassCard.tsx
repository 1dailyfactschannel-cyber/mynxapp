import { type ReactNode, type MouseEventHandler } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function GlassCard({ children, className, hover = false, onClick }: GlassCardProps) {
  return (
    <div className={cn("glass-card", hover && "hoverable", className)} onClick={onClick}>
      {children}
    </div>
  );
}
