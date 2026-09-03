import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Plus, Lock, FolderOpen, ChevronRight, ArrowLeft } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useAppStore, isTauri } from "@/stores/app";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n";

interface VaultFile {
  id: string;
  name: string;
  path: string;
}

interface VaultSelectorProps {
  onSelectVault: () => void;
  onCreateVault: () => void;
}

export function VaultSelector({ onSelectVault, onCreateVault }: VaultSelectorProps) {
  const [vaults, setVaults] = useState<VaultFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useI18n();

  useEffect(() => {
    loadVaults();
  }, []);

  const loadVaults = async () => {
    try {
      if (!isTauri) {
        setVaults([{ id: "demo/Personal.safepass", name: "Personal", path: "demo/Personal.safepass" }]);
        return;
      }
      const files = await invoke<string[]>("list_vault_files");
      setVaults(
        files.map((path) => ({
          id: path,
          name: path.split(/[\\/]/).pop()?.replace(".safepass", "") || "Vault",
          path,
        }))
      );
    } catch (e) {
      console.error("Failed to load vaults:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (vaultId: string) => {
    useAppStore.setState({ activeVault: vaultId });
    onSelectVault();
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(16,185,129,0)",
                "0 0 40px 10px var(--accent-shadow)",
                "0 0 0 0 rgba(16,185,129,0)",
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="icon-badge w-16 h-16 rounded-2xl inline-flex mb-4"
          >
            <Shield className="w-8 h-8" />
          </motion.div>
          <h1 className="text-2xl font-bold t1 mb-1">{t("selectVault")}</h1>
          <p className="t2 text-sm">{t("chooseVault")}</p>
        </div>

        <div className="space-y-3 mb-6">
          <AnimatePresence>
            {vaults.map((vault, index) => (
              <motion.div
                key={vault.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <GlassCard
                  hover
                  className="p-4 cursor-pointer group"
                  onClick={() => handleSelect(vault.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="icon-badge w-10 h-10">
                        <FolderOpen className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-medium t1 transition-colors group-hover:[color:var(--accent-soft-text)]">
                          {vault.name}
                        </h3>
                        <p className="text-xs t3 truncate max-w-[200px]">{vault.path}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 t3 transition-colors group-hover:[color:var(--t1)]" />
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </AnimatePresence>

          {vaults.length === 0 && !isLoading && (
            <div className="text-center py-8 t3">
              <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p>{t("noVaults")}</p>
              <p className="text-sm mt-1">{t("createFirst")}</p>
            </div>
          )}
        </div>

        <motion.button
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.985 }}
          onClick={onCreateVault}
          className="btn-primary w-full py-3"
        >
          <Plus className="w-4 h-4" />
          {t("createNewVault")}
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.985 }}
          onClick={onSelectVault}
          className="btn-ghost w-full mt-3 py-2.5 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("backToUnlock")}
        </motion.button>
      </motion.div>
    </div>
  );
}
