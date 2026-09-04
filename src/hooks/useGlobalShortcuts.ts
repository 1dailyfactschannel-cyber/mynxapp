import { useEffect } from "react";
import type { ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";

import { isTauri } from "@/stores/session";
import { useAppStore } from "@/stores/app";
import { useVaultStore, type Entry } from "@/stores/vault";
import { isSecureBufferEmpty } from "@/lib/errors";
import { matchEntries } from "@/lib/autotype";

export interface GlobalShortcutHandlers {
  hotkeyQuickAdd: string;
  hotkeyAutoType: string;
  hotkeyGenerator: string;
  hotkeyLock: string;
  hotkeySecurePaste: string;
  /** Сеттер, переключающий модалку Quick Add */
  toggleQuickAdd: () => void;
  /** Сеттер, открывающий генератор */
  openGenerator: () => void;
  /** Локальный вызов lock (через стор) */
  lock: () => Promise<void>;
}

/**
 * Регистрирует глобальные хоткеи приложения через tauri-plugin-global-shortcut.
 *
 * Поведение:
 *  - каждый shortcut регистрируется независимо: ошибка одного не
 *    валит остальные;
 *  - при изменении любой строки в deps хуки снимаются и перевешиваются;
 *  - при isTauri=false — no-op (для браузерного demo);
 *  - хоткей Auto-Type: если в foreground Mynx — печатает выбранную запись;
 *    если в foreground другое окно с известным title — печатает её
 *    (или показывает picker, если совпадений несколько).
 *  - хоткей Secure Paste: ошибку "secure_buffer_empty" молча игнорируем.
 */
export function useGlobalShortcuts(h: GlobalShortcutHandlers): void {
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    const registered: string[] = [];

    const register = async () => {
      const { register, unregister } = await import(
        "@tauri-apps/plugin-global-shortcut"
      );

      // Каждое сочетание — независимо: конфликт одного не роняет второе
      const tryRegister = async (
        accelerator: string,
        handler: (event: ShortcutEvent) => void
      ) => {
        try {
          await register(accelerator, handler);
          registered.push(accelerator);
        } catch (e) {
          console.error(`Failed to register global shortcut ${accelerator}:`, e);
        }
      };

      // Quick Add
      await tryRegister(h.hotkeyQuickAdd, (event) => {
        if (event.state !== "Pressed") return;
        // Сначала показать окно (может быть свёрнуто в трей), потом Quick Add
        showMainWindow();
        h.toggleQuickAdd();
      });

      // Auto-Type
      await tryRegister(h.hotkeyAutoType, (event) => {
        if (event.state !== "Pressed") return;

        // Старое поведение: печать выбранной в списке записи
        const typeSelected = () => {
          const currentEntry = useVaultStore.getState().selectedEntry;
          if (!currentEntry) {
            console.warn("Auto-type: no entry selected");
            return;
          }
          const entry = useVaultStore.getState().entries.find(
            (e) => e.id === currentEntry
          );
          if (entry) {
            void invokeAutoType(entry);
          } else {
            console.warn("Auto-type: selected entry not found");
          }
        };

        void (async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();

          // Хранилище закрыто — просто показываем окно для разблокировки
          if (!useAppStore.getState().isUnlocked) {
            void win
              .show()
              .then(() => win.unminimize())
              .then(() => win.setFocus())
              .catch(() => {});
            return;
          }

          const fg = await invoke<{ title: string; is_self: boolean }>(
            "get_foreground_window"
          );

          // Фокус на самом Mynx или заголовок не получен — печатаем выбранную запись
          if (fg.is_self || !fg.title) {
            typeSelected();
            return;
          }

          const matches = matchEntries(
            useVaultStore.getState().entries,
            fg.title
          );
          if (matches.length === 1) {
            // Единственное совпадение — скрываем окно и печатаем сразу
            const entry = matches[0];
            await win.hide();
            invoke("auto_type_credentials", {
              username: entry.username,
              password: entry.password,
            }).catch(console.error);
          } else {
            // 0 или несколько совпадений — показываем окно с пикером
            void win
              .show()
              .then(() => win.unminimize())
              .then(() => win.setFocus())
              .catch(() => {});
            // Поднимем событие — VaultScreen подхватит и откроет AutoTypePicker
            window.dispatchEvent(
              new CustomEvent("mynx:auto-type-pick", {
                detail: { windowTitle: fg.title, matches },
              })
            );
          }
        })().catch((e) => console.error("Auto-type failed:", e));
      });

      // Generator
      await tryRegister(h.hotkeyGenerator, (event) => {
        if (event.state !== "Pressed") return;
        showMainWindow();
        h.openGenerator();
      });

      // Lock
      await tryRegister(h.hotkeyLock, (event) => {
        if (event.state !== "Pressed") return;
        void h.lock();
      });

      // Secure paste
      await tryRegister(h.hotkeySecurePaste, (event) => {
        if (event.state !== "Pressed") return;
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("secure_paste").catch((e) => {
            if (!isSecureBufferEmpty(e)) console.error(e);
          });
        });
      });

      if (cancelled) {
        for (const s of registered) await unregister(s).catch(() => {});
      }
    };

    register().catch((e) =>
      console.error("Failed to register global shortcuts:", e)
    );

    return () => {
      cancelled = true;
      import("@tauri-apps/plugin-global-shortcut")
        .then(({ unregister }) =>
          registered.forEach((s) => unregister(s).catch(() => {}))
        )
        .catch(() => {});
    };
  }, [
    h.hotkeyQuickAdd,
    h.hotkeyAutoType,
    h.hotkeyGenerator,
    h.hotkeyLock,
    h.hotkeySecurePaste,
    h.toggleQuickAdd,
    h.openGenerator,
    h.lock,
  ]);
}

function showMainWindow() {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    void win
      .show()
      .then(() => win.unminimize())
      .then(() => win.setFocus())
      .catch(() => {});
  });
}

function invokeAutoType(entry: Entry) {
  import("@tauri-apps/api/core").then(({ invoke }) => {
    invoke("auto_type_credentials", {
      username: entry.username,
      password: entry.password,
    }).catch(console.error);
  });
}
