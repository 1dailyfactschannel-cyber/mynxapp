/* ================================================================== */
/* Drag & Drop: MIME-типы и утилиты для нативного HTML5 DnD.           */
/* Перетаскивание: записи → категории, категории → порядок,            */
/* вложения → папки/порядок. Без внешних зависимостей.                 */
/* ================================================================== */

/** Перетаскиваемая запись хранилища (dataTransfer: entry id) */
export const ENTRY_MIME = "application/x-mynx-entry";
/** Перетаскиваемая категория сайдбара (переупорядочивание) */
export const CATEGORY_MIME = "application/x-mynx-category";
/** Перетаскиваемое вложение (перемещение в папку / порядок) */
export const ATTACHMENT_MIME = "application/x-mynx-attachment";
/** Перетаскиваемая папка вложений (переупорядочивание) */
export const FOLDER_MIME = "application/x-mynx-folder";

/** Проверить, несёт ли событие перетаскивание заданного типа */
export function hasDragType(e: React.DragEvent, mime: string): boolean {
  // types — DOMStringList-подобный массив; в некоторых движках includes отсутствует
  return Array.from(e.dataTransfer?.types ?? []).includes(mime);
}

/** Достать id из dataTransfer (getData работает только в onDrop) */
export function getDragId(e: React.DragEvent, mime: string): string | null {
  const v = e.dataTransfer?.getData(mime);
  return v || null;
}
