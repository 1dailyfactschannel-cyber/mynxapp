import { Fragment, type ReactNode } from "react";

/** Инлайн-разметка: **жирный**, `код`, *курсив*. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="t1 font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded text-[11px]"
          style={{
            background: "var(--field-bg)",
            border: "1px solid var(--field-border)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Таблица markdown (блок строк, начинающихся с |). */
function renderTable(lines: string[], key: string) {
  const rows = lines
    .filter((l) => !/^\|[\s\-|]+\|$/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
    );
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  return (
    <div key={key} className="overflow-x-auto my-3">
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {head.map((c, i) => (
              <th
                key={i}
                className="text-left py-1.5 px-2 t1 font-semibold"
                style={{ borderBottom: "1px solid var(--divider)" }}
              >
                {renderInline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => (
                <td
                  key={ci}
                  className="py-1.5 px-2 t2 align-top"
                  style={{ borderBottom: "1px solid var(--divider)" }}
                >
                  {renderInline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Минимальный markdown-рендерер под USER-GUIDE: заголовки ###, таблицы,
 * списки (- и 1.), параграфы, инлайн-разметка bold/code. Не полный CommonMark.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed === "---") {
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4 key={key++} className="text-sm font-semibold t1 mt-4 mb-1.5">
          {renderInline(trimmed.slice(4))}
        </h4>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(renderTable(tableLines, `t${key++}`));
      continue;
    }

    if (/^- /.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 my-2 space-y-1 text-xs t2 leading-relaxed">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\. /.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\. /, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-5 my-2 space-y-1 text-xs t2 leading-relaxed">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Параграф: до пустой строки или начала другого блока
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("|") &&
      !/^- /.test(lines[i].trim()) &&
      !/^\d+\. /.test(lines[i].trim()) &&
      lines[i].trim() !== "---"
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="text-xs t2 leading-relaxed my-2">
        {renderInline(para.join(" "))}
      </p>
    );
  }

  return <>{blocks}</>;
}
