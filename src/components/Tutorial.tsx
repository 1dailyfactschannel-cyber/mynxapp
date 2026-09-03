import { useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  GraduationCap,
  BookOpen,
  Info,
  KeyRound,
  ListPlus,
  Keyboard,
  FileDown,
  ShieldCheck,
  Plus,
  Paperclip,
  Archive,
  MemoryStick,
  Library,
  Search,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { Markdown } from "@/components/Markdown";
import { guideSections } from "@/lib/guide";
import { useI18n } from "@/i18n";

interface TutorialProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "guide" | "faq" | "kb";

export function Tutorial({ isOpen, onClose }: TutorialProps) {
  const [tab, setTab] = useState<Tab>("guide");
  const [kbQuery, setKbQuery] = useState("");
  const { t } = useI18n();

  const q = kbQuery.trim().toLowerCase();
  const kbSections = q
    ? guideSections.filter((s) =>
        `${s.title}\n${s.body}`.toLowerCase().includes(q)
      )
    : guideSections;

  const steps = [
    { icon: KeyRound, title: t("tutStep1T"), text: t("tutStep1D") },
    { icon: ListPlus, title: t("tutStep2T"), text: t("tutStep2D") },
    { icon: Keyboard, title: t("tutStep3T"), text: t("tutStep3D") },
    { icon: FileDown, title: t("tutStep4T"), text: t("tutStep4D") },
    { icon: ShieldCheck, title: t("tutStep5T"), text: t("tutStep5D") },
    { icon: Plus, title: t("tutStep6T"), text: t("tutStep6D") },
    { icon: Paperclip, title: t("tutStep7T"), text: t("tutStep7D") },
    { icon: Archive, title: t("tutStep8T"), text: t("tutStep8D") },
    { icon: MemoryStick, title: t("tutStep9T"), text: t("tutStep9D") },
  ];

  const faqs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => ({
    q: t(`tutFaq${i}Q`),
    a: t(`tutFaq${i}A`),
  }));

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <GlassCard className="w-[80%] max-h-[90vh] overflow-y-auto pointer-events-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="icon-badge w-10 h-10">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold t1">{t("tutTitle")}</h2>
                  <p className="text-xs t3">{t("tutDesc")}</p>
                </div>
              </div>
              <button onClick={onClose} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-5">
              <button
                onClick={() => setTab("guide")}
                className={`segment ${tab === "guide" ? "active" : ""}`}
              >
                <BookOpen className="w-4 h-4" />
                {t("tutTabGuide")}
              </button>
              <button
                onClick={() => setTab("faq")}
                className={`segment ${tab === "faq" ? "active" : ""}`}
              >
                <Info className="w-4 h-4" />
                {t("tutTabFaq")}
              </button>
              <button
                onClick={() => setTab("kb")}
                className={`segment ${tab === "kb" ? "active" : ""}`}
              >
                <Library className="w-4 h-4" />
                {t("tutTabKb")}
              </button>
            </div>

            {tab === "kb" ? (
              <>
                <div className="relative mb-4">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 t3" />
                  <input
                    type="text"
                    value={kbQuery}
                    onChange={(e) => setKbQuery(e.target.value)}
                    placeholder={t("kbSearch")}
                    className="field rounded-xl pl-9 pr-4 py-2.5 text-sm w-full"
                  />
                </div>
                {kbSections.length === 0 ? (
                  <p className="text-xs t3 text-center py-8">{t("kbEmpty")}</p>
                ) : (
                  <div className="space-y-3">
                    {kbSections.map((section) => (
                      <GlassCard key={section.id} className="p-4">
                        <p className="text-sm font-medium t1 mb-1">{section.title}</p>
                        <Markdown text={section.body} />
                      </GlassCard>
                    ))}
                  </div>
                )}
              </>
            ) : tab === "guide" ? (
              <>
                <div className="space-y-3">
                  {steps.map((step, i) => (
                    <GlassCard key={i} className="p-4 flex items-start gap-3">
                      <div className="icon-badge w-9 h-9 flex-shrink-0">
                        <step.icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium t1">
                          {i + 1}. {step.title}
                        </p>
                        <p className="text-xs t2 mt-1 leading-relaxed">{step.text}</p>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                {faqs.map((faq, i) => (
                  <GlassCard key={i} className="p-4">
                    <p className="text-sm font-medium t1">{faq.q}</p>
                    <p className="text-xs t2 mt-1.5 leading-relaxed">{faq.a}</p>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
