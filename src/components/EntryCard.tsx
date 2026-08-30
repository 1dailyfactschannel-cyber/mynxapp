import { useState } from "react";
import { Copy, Eye, EyeOff, Star } from "lucide-react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/GlassCard";
import { useI18n } from "@/i18n";
import type { Entry } from "@/stores/vault";

interface EntryCardProps {
  entry: Entry;
  onSelect: (id: string) => void;
  onCopyPassword: (password: string) => void;
  onToggleFavorite: (id: string) => void;
}

export function EntryCard({ entry, onSelect, onCopyPassword, onToggleFavorite }: EntryCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const { t } = useI18n();

  const strengthBgClass =
    entry.strength >= 80
      ? "bg-strong"
      : entry.strength >= 50
      ? "bg-good"
      : entry.strength >= 30
      ? "bg-fair"
      : "bg-weak";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      whileHover={{ x: 4 }}
      className="cursor-pointer"
      onClick={() => onSelect(entry.id)}
    >
      <GlassCard hover className="p-4 group">
        <div className="flex items-center gap-4">
          <div className="icon-tile w-10 h-10 rounded-xl flex items-center justify-center text-lg">
            {entry.icon || "🔐"}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium t1 text-sm truncate">{entry.title}</h3>
              {entry.favorite && (
                <Star className="w-3 h-3" style={{ color: "var(--warn)", fill: "var(--warn)" }} />
              )}
            </div>
            <p className="t3 text-xs truncate">{entry.username}</p>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(entry.id);
              }}
              className="icon-btn"
              title={t("favoriteToggle")}
            >
              <Star
                className="w-4 h-4"
                style={
                  entry.favorite
                    ? { color: "var(--warn)", fill: "var(--warn)" }
                    : undefined
                }
              />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopyPassword(entry.password);
              }}
              className="icon-btn"
              title={t("copyPasswordTitle")}
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPassword(!showPassword);
              }}
              className="icon-btn"
              title={t("showPasswordTitle")}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {showPassword && (
          <div
            className="mt-3 px-3 py-2 rounded-lg font-mono text-sm t1 select-all"
            style={{
              background: "var(--field-bg)",
              border: "1px solid var(--field-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {entry.password}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div
            className="flex-1 h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--kbd-bg)" }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${entry.strength}%` }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className={`h-full rounded-full ${strengthBgClass}`}
            />
          </div>
          <span className="text-xs t3 w-8 text-right">{entry.strength}</span>
        </div>

        {entry.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.tags.map((tag) => (
              <span key={tag} className="chip !text-[10px]">
                {tag}
              </span>
            ))}
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
