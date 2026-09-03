import { defineConfig } from "vitest/config";
import path from "path";

// Отдельный конфиг тестов: алиас "@/src" как в vite.config.ts,
// окружение по умолчанию node; файлы, которым нужен DOM/IndexedDB,
// переключают окружение комментарием `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    reporters: "default",
  },
});
