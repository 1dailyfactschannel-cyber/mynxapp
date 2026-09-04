import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GlassCard } from "@/components/GlassCard";
import { useI18n } from "@/i18n";
import { useAppStore, isTauri } from "@/stores/app";
import { AlertTriangle, RefreshCw, Lock } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Где граница:
   *  - "root"    — весь App, при падении блокирует vault и показывает экран
   *  - "panel"   — отдельная модалка/секция, при падении только её скрывает
   */
  scope?: "root" | "panel";
  /** Запасной UI для panel-границы */
  panelFallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Ловит рендер-ошибки в дочерних компонентах. На root-уровне:
 * 1. Синхронно шлёт команду `vault_lock` (best-effort, чтобы секреты
 *    не остались в памяти, если падение пришло во время открытой сессии).
 * 2. Сбрасывает записи в vault-сторе.
 * 3. Показывает экран с кнопкой «Перезагрузить» (полная перезагрузка webview).
 *
 * SECURITY: при падении рендера не доверяем фронту — лучше уйти в lock,
 * чем оставить разблокированный vault без UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Лог: всегда в консоль, в Tauri — продублируем в backend-лог.
    // Сам по себе console.error уже идёт в наш лог-файл через Tauri.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] render error:", error, info.componentStack);

    if (this.props.scope === "root") {
      void this.emergencyLock();
    }
  }

  private async emergencyLock(): Promise<void> {
    try {
      // 1. Дёргаем backend-lock (best-effort): даже если webview не отвечает,
      //    RAM затрётся на стороне Rust.
      if (isTauri) {
        await invoke("vault_lock").catch(() => {
          /* ничего — UI и так встал */
        });
      }
    } finally {
      // 2. Локально чистим записи и флаги — даже если backend не ответил,
      //    фронт не должен хранить расшифрованные записи.
      try {
        const { useVaultStore } = await import("@/stores/vault");
        useVaultStore.getState().setEntries([]);
        useVaultStore.getState().setSelectedEntry(null);
        useAppStore.setState({
          isLocked: true,
          isUnlocked: false,
          isDecoySession: false,
          decoyEnabled: false,
          screen: "lock",
        });
      } catch {
        /* и это не критично */
      }
    }
  }

  private handleReload = (): void => {
    // Полная перезагрузка webview: чистый стейт, требуется повторный unlock.
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.scope === "panel" && this.props.panelFallback !== undefined) {
      return this.props.panelFallback;
    }

    if (this.props.scope === "panel") {
      return (
        <div className="soft-warn p-3 rounded-lg text-sm border">
          Компонент временно недоступен
        </div>
      );
    }

    return <RootCrashScreen onReload={this.handleReload} error={error} />;
  }
}

function RootCrashScreen({ error, onReload }: { error: Error; onReload: () => void }): JSX.Element {
  const { t } = useI18n();

  return (
    <div className="h-full flex items-center justify-center p-8 bg-[var(--bg)]">
      <GlassCard className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-[var(--danger)]" />
          <h1 className="text-lg font-semibold t1">Произошла ошибка интерфейса</h1>
        </div>

        <p className="text-sm opacity-80">
          Хранилище заблокировано в целях безопасности. Секреты удалены из памяти
          приложения.
        </p>

        <details className="text-xs opacity-60">
          <summary className="cursor-pointer">Технические детали</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{String(error)}</pre>
        </details>

        <div className="flex gap-2">
          <button
            onClick={onReload}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            {t("restart") || "Перезагрузить"}
          </button>
          <span className="text-xs opacity-60 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            vault locked
          </span>
        </div>
      </GlassCard>
    </div>
  );
}
