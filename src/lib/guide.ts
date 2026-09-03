import guideMd from "../../docs/USER-GUIDE.md?raw";

export interface GuideSection {
  id: string;
  title: string;
  body: string;
}

/** Разбить USER-GUIDE.md на разделы по заголовкам "## ". Служебные секции пропускаем. */
export const guideSections: GuideSection[] = (() => {
  const sections: GuideSection[] = [];
  const re = /^## (.+)$/gm;
  const matches = [...guideMd.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    if (title === "Содержание") continue;
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : guideMd.length;
    const body = guideMd.slice(start, end).trim();
    sections.push({ id: `guide-${sections.length}`, title, body });
  }
  return sections;
})();
