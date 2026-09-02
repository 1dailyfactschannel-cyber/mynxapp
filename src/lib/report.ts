/* ================================================================== */
/* Печать HTML-отчёта (Ctrl+P → «Сохранить как PDF» в WebView2).       */
/* Рендерим разметку в скрытый iframe — окно приложения не трогаем,    */
/* юникод (кириллица) работает из коробки, в отличие от jsPDF.         */
/* ================================================================== */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #1a1d24; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #d9dde4; padding-bottom: 4px; }
  .meta { color: #5a6472; font-size: 12px; margin-bottom: 16px; }
  .badges { display: flex; gap: 10px; margin: 14px 0 4px; }
  .badge { border: 1px solid #d9dde4; border-radius: 8px; padding: 8px 14px; }
  .badge b { display: block; font-size: 20px; }
  .badge span { font-size: 11px; color: #5a6472; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eceff3; }
  th { color: #5a6472; font-weight: 600; }
  .muted { color: #5a6472; }
`;

/** Открыть системный диалог печати с готовым отчётом */
export function printHtmlReport(title: string, bodyHtml: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>${REPORT_CSS}</style></head><body>${bodyHtml}</body></html>`
  );
  doc.close();

  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => iframe.remove(), 500);
  };
  win.onafterprint = cleanup;
  // Safari-подобные движки не всегда зовут onafterprint — страховка
  setTimeout(cleanup, 90_000);

  setTimeout(() => {
    win.focus();
    win.print();
  }, 150);
}

export { escapeHtml };
