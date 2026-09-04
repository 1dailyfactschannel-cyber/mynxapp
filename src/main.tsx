import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@/i18n";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import App from "./App";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <I18nProvider>
        {/* Root-граница: при падении рендера блокирует vault и показывает
            экран восстановления. Локальные panel-границы вешаются ниже
            вокруг тяжёлых модалок (Settings/EntryDetail/Health). */}
        <ErrorBoundary scope="root">
          <App />
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);
