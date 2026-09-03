import { motion } from "framer-motion";
import type { ReactNode } from "react";

/* ================================================================== */
/* Пустые состояния с анимированными SVG-иллюстрациями.                */
/* Без внешних ассетов — рисуем на месте, уважаем reduced-motion.      */
/* ================================================================== */

export type EmptyVariant =
  | "search"
  | "category"
  | "trash"
  | "attachments"
  | "passkeys"
  | "generic";

interface EmptyStateProps {
  variant: EmptyVariant;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

/** Мягкая «плавающая» анимация, отключается при data-motion="reduced" */
const float = {
  animate: { y: [0, -4, 0] },
  transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" as const },
};

function Illustration({ variant }: { variant: EmptyVariant }) {
  const stroke = "var(--t3-icon, var(--divider))";
  const accent = "var(--accent)";

  return (
    <motion.svg
      width="132"
      height="104"
      viewBox="0 0 132 104"
      fill="none"
      aria-hidden="true"
      {...float}
      className="empty-illustration"
    >
      {/* общая мягкая подложка */}
      <ellipse cx="66" cy="92" rx="44" ry="7" fill={stroke} opacity="0.25" />

      {variant === "search" && (
        <>
          <motion.g animate={{ x: [0, 5, 0] }} transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}>
            <circle cx="58" cy="46" r="24" stroke={accent} strokeWidth="4" opacity="0.9" />
            <line x1="76" y1="64" x2="92" y2="80" stroke={accent} strokeWidth="6" strokeLinecap="round" opacity="0.9" />
          </motion.g>
          <text x="52" y="54" fontSize="20" fill={stroke} opacity="0.8">?</text>
        </>
      )}

      {variant === "category" && (
        <>
          <path
            d="M22 36c0-4 3-7 7-7h18l8 9h38c4 0 7 3 7 7v34c0 4-3 7-7 7H29c-4 0-7-3-7-7V36z"
            stroke={accent}
            strokeWidth="4"
            opacity="0.9"
          />
          <motion.circle
            cx="102" cy="26" r="4" fill={accent}
            animate={{ scale: [1, 1.35, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.circle
            cx="20" cy="20" r="3" fill={stroke}
            animate={{ scale: [1, 1.5, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          />
          <motion.path
            d="M40 62c6-8 16-8 22 0"
            stroke={stroke} strokeWidth="3" strokeLinecap="round" opacity="0.7"
            animate={{ pathLength: [0.6, 1, 0.6] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </>
      )}

      {variant === "trash" && (
        <>
          <path
            d="M40 34h52l-5 52c-.5 4-3.5 7-7.5 7h-27c-4 0-7-3-7.5-7L40 34z"
            stroke={accent} strokeWidth="4" opacity="0.9"
          />
          <path d="M32 34h68" stroke={accent} strokeWidth="4" strokeLinecap="round" opacity="0.9" />
          <path d="M56 26h20v8H56z" stroke={accent} strokeWidth="4" opacity="0.9" />
          <motion.path
            d="M56 48v34M76 48v34"
            stroke={stroke} strokeWidth="3" strokeLinecap="round" opacity="0.6"
            animate={{ opacity: [0.2, 0.7, 0.2] }}
            transition={{ duration: 2.8, repeat: Infinity }}
          />
        </>
      )}

      {variant === "attachments" && (
        <>
          <path
            d="M78 40 56 62c-6 6-6 15 0 21s15 6 21 0l26-26c8-8 8-21 0-29s-21-8-29 0L48 54"
            stroke={accent} strokeWidth="4.5" strokeLinecap="round" opacity="0.9"
          />
          <motion.circle
            cx="48" cy="54" r="5" fill={accent}
            animate={{ scale: [0.8, 1.25, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity }}
          />
        </>
      )}

      {variant === "passkeys" && (
        <>
          <circle cx="60" cy="42" r="17" stroke={accent} strokeWidth="4" opacity="0.9" />
          <path d="M60 34v10h8" stroke={accent} strokeWidth="3.5" strokeLinecap="round" opacity="0.9" />
          <path
            d="M71 55l22 22M87 71l7-7M80 64l7-7"
            stroke={accent} strokeWidth="4.5" strokeLinecap="round" opacity="0.9"
          />
          <motion.path
            d="M52 42c2-5 8-5 10 0"
            stroke={stroke} strokeWidth="3" strokeLinecap="round" opacity="0.7"
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 2.4, repeat: Infinity }}
          />
        </>
      )}

      {variant === "generic" && (
        <>
          <path
            d="M66 20l30 12v22c0 20-13 32-30 38-17-6-30-18-30-38V32l30-12z"
            stroke={accent} strokeWidth="4" opacity="0.9"
          />
          <motion.path
            d="M54 54l8 8 16-16"
            stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"
            animate={{ pathLength: [0.5, 1, 0.5] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </>
      )}
    </motion.svg>
  );
}

export function EmptyState({ variant, title, hint, action, className = "" }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col items-center justify-center text-center py-10 ${className}`}
    >
      <Illustration variant={variant} />
      <p className="t2 font-medium mt-4">{title}</p>
      {hint && <p className="t3 text-sm mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}
