import { Minus, X, Shield } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export function TitleBar() {
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTauri) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    getCurrentWindow().startDragging();
  };

  const handleMinimize = async () => {
    if (!isTauri) return;
    await getCurrentWindow().minimize();
  };

  const handleClose = async () => {
    if (!isTauri) return;
    await getCurrentWindow().close();
  };

  return (
    <div
      className="h-10 flex-shrink-0 flex items-center justify-between px-3 select-none z-[100]"
      style={{
        background: "var(--chrome-header-bg)",
        borderBottom: "1px solid var(--divider)",
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center gap-2">
        <div className="icon-badge w-5 h-5">
          <Shield className="w-3 h-3" />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleMinimize}
          className="icon-btn"
          type="button"
          title="Minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleClose}
          className="icon-btn danger"
          type="button"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
