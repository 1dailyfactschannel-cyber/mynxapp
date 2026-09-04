import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  soon?: string;
  icon?: ReactNode;
}

/**
 * Анимированный переключатель со spring-анимацией ползунка.
 * Используется во всех секциях настроек (security, appearance, a11y и т.д.).
 */
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  soon,
  icon,
}: ToggleProps) {
  return (
    <div
      className={`flex items-center justify-between ${disabled ? "opacity-60" : "cursor-pointer"}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="text-sm t1 flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="flex items-center gap-2">
        {soon && <span className="soon-badge">{soon}</span>}
        <div className={`toggle-track ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}>
          <motion.div
            animate={{ x: checked ? 20 : 2 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="toggle-thumb"
          />
        </div>
      </span>
    </div>
  );
}
