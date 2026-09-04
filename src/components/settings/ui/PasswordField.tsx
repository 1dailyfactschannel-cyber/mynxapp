import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
}

/**
 * Поле ввода пароля с иконкой «показать/скрыть» и поддержкой Enter
 * (для сабмита модалки без клика по кнопке).
 */
export function PasswordField({
  value,
  onChange,
  placeholder,
  onEnter,
  autoFocus,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="field rounded-xl px-3.5 py-2.5 pr-10 text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 t3"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
