import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";

interface ActionModalProps {
  title: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Базовый shell для модалок действия (export, import, change-pw и т.д.).
 * Содержит overlay, карточку, заголовок с иконкой и кнопкой закрытия.
 * Содержимое передаётся через children.
 */
export function ActionModal({ title, icon, onClose, children }: ActionModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[55]"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-[60] p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-md pointer-events-auto">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {icon}
                <h3 className="text-base font-semibold t1">{title}</h3>
              </div>
              <button onClick={onClose} className="icon-btn">
                <X className="w-4 h-4" />
              </button>
            </div>
            {children}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
