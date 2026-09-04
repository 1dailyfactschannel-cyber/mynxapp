import type { ReactNode } from "react";

interface FieldLabelProps {
  children: ReactNode;
}

export function FieldLabel({ children }: FieldLabelProps) {
  return <span className="block text-xs t3 mb-1.5">{children}</span>;
}
