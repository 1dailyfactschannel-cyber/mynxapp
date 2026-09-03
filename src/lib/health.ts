/* ================================================================== */
/* Health 2.0: анализ состояния хранилища.                             */
/* Возраст паролей — по дате последней смены пароля (passwordHistory), */
/* фолбэк — createdAt/updatedAt. Тренд — снапшоты в localStorage.      */
/* Все вычисления детерминированы и покрыты тестами.                   */
/* ================================================================== */

import type { Entry } from "@/stores/vault";

/** Дата последней смены пароля записи (ms) */
export function passwordChangedAt(entry: Entry): number | null {
  const last = entry.passwordHistory?.[0]?.changedAt;
  if (last && Number.isFinite(last)) return last;
  // Пароль ни разу не меняли — берём дату создания, затем updatedAt
  if (entry.createdAt && Number.isFinite(entry.createdAt)) return entry.createdAt;
  if (entry.updatedAt && Number.isFinite(entry.updatedAt)) return entry.updatedAt;
  return null;
}

/** Возраст пароля в днях (0 — изменён сегодня); null — дата неизвестна */
export function passwordAgeDays(entry: Entry, now = Date.now()): number | null {
  const at = passwordChangedAt(entry);
  if (at === null) return null;
  return Math.max(0, Math.floor((now - at) / (24 * 3600 * 1000)));
}

export interface HealthAnalysis {
  /** Итоговый балл 0–100: сила − штрафы за повторы и просрочку */
  totalScore: number;
  /** Базовая средняя сила паролей 0–100 */
  baseStrength: number;
  weak: Entry[];
  reused: Entry[];
  /** Пароли старше порога ротации — «пора ротировать» */
  rotationDue: Entry[];
  /** Возраст каждой просроченной записи (дней), параллельно rotationDue */
  rotationAges: Record<string, number>;
  no2fa: Entry[];
  /** Средний возраст пароля, дней */
  avgPasswordAgeDays: number | null;
  total: number;
}

export function analyzeHealth(
  entries: Entry[],
  rotationThresholdDays: number,
  now = Date.now()
): HealthAnalysis {
  const active = entries.filter((e) => !e.deletedAt);
  const total = active.length;

  const weak = active.filter((e) => e.strength < 50);

  const reused = active.filter((e) =>
    e.password && active.some((o) => o.id !== e.id && o.password === e.password)
  );

  const rotationDue: Entry[] = [];
  const rotationAges: Record<string, number> = {};
  const ages: number[] = [];
  for (const e of active) {
    const age = passwordAgeDays(e, now);
    if (age === null) continue;
    ages.push(age);
    if (rotationThresholdDays > 0 && age > rotationThresholdDays) {
      rotationDue.push(e);
      rotationAges[e.id] = age;
    }
  }
  const avgPasswordAgeDays =
    ages.length > 0 ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null;

  const no2fa = active.filter((e) => !e.totpSecret && !e.tags.includes("2fa"));

  const baseStrength =
    total > 0 ? Math.round(active.reduce((s, e) => s + e.strength, 0) / total) : 0;

  // Штрафы: повторы до −20, просрочка ротации до −15
  const reuseShare = total > 0 ? reused.length / total : 0;
  const rotationShare = total > 0 ? rotationDue.length / total : 0;
  const penalty = Math.min(20, Math.round(reuseShare * 40)) + Math.min(15, Math.round(rotationShare * 30));
  const totalScore = total === 0 ? 0 : Math.max(0, Math.min(100, baseStrength - penalty));

  return {
    totalScore,
    baseStrength,
    weak,
    reused,
    rotationDue,
    rotationAges,
    no2fa,
    avgPasswordAgeDays,
    total,
  };
}

/* ------------------------------------------------------------------ */
/* История Health-балла (снапшоты в localStorage, не больше 90)        */
/* ------------------------------------------------------------------ */

export interface HealthSnapshot {
  at: number;
  score: number;
  weak: number;
  reused: number;
  rotationDue: number;
  total: number;
}

const HISTORY_KEY = "mynx-health-history";
const HISTORY_MAX = 90;
const DAY_MS = 24 * 3600 * 1000;

export function loadHealthHistory(storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage): HealthSnapshot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HealthSnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s) =>
          s &&
          typeof s.at === "number" &&
          typeof s.score === "number" &&
          Number.isFinite(s.score)
      )
      .sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

/**
 * Записать снапшот текущего состояния (вызывается при открытии health-панели).
 * Один снапшот на день: повторный вызов в тот же день обновляет его.
 */
export function recordHealthSnapshot(
  entries: Entry[],
  rotationThresholdDays: number,
  now = Date.now(),
  storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage
): HealthSnapshot[] {
  const a = analyzeHealth(entries, rotationThresholdDays, now);
  const snap: HealthSnapshot = {
    at: now,
    score: a.totalScore,
    weak: a.weak.length,
    reused: a.reused.length,
    rotationDue: a.rotationDue.length,
    total: a.total,
  };

  const history = loadHealthHistory(storage);
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const withoutToday = history.filter((s) => new Date(s.at).setHours(0, 0, 0, 0) !== dayStart);
  const next = [...withoutToday, snap].slice(-HISTORY_MAX);

  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* переполнение квоты — история не критична */
  }
  return next;
}

/** Изменение балла за последние `days` дней (null — истории мало) */
export function trendDelta(history: HealthSnapshot[], days = 7, now = Date.now()): number | null {
  if (history.length < 2) return null;
  const cutoff = now - days * DAY_MS;
  const past = history.filter((s) => s.at <= cutoff);
  const baseline = past.length > 0 ? past[past.length - 1] : history[0];
  const latest = history[history.length - 1];
  if (baseline === latest) return null;
  return latest.score - baseline.score;
}

/* ------------------------------------------------------------------ */
/* CSV-экспорт отчёта                                                  */
/* ------------------------------------------------------------------ */

function csvEscape(v: string | number): string {
  const s = String(v);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV-отчёт (UTF-8 c BOM — Excel/Sheets корректно читают кириллицу).
 * Пароли не включаются никогда — только метаданные и баллы.
 */
export function buildHealthCsv(
  analysis: HealthAnalysis,
  entries: Entry[],
  rotationThresholdDays: number,
  now = Date.now()
): string {
  const rows: (string | number)[][] = [];
  rows.push(["Mynx Health Report"]);
  rows.push(["Generated", new Date(now).toISOString()]);
  rows.push(["Entries", analysis.total]);
  rows.push(["Total score", analysis.totalScore]);
  rows.push(["Base strength", analysis.baseStrength]);
  rows.push(["Avg password age (days)", analysis.avgPasswordAgeDays ?? ""]);
  rows.push(["Rotation threshold (days)", rotationThresholdDays]);
  rows.push([]);
  rows.push(["Section", "Title", "Detail"]);

  for (const e of analysis.rotationDue) {
    rows.push(["rotation_due", e.title, `${analysis.rotationAges[e.id]} days`]);
  }
  for (const e of analysis.weak) {
    rows.push(["weak_password", e.title, `strength ${e.strength}`]);
  }
  const reuseCounts = new Map<string, number>();
  for (const e of analysis.reused) {
    reuseCounts.set(e.password, (reuseCounts.get(e.password) ?? 0) + 1);
  }
  for (const e of analysis.reused) {
    rows.push(["reused_password", e.title, `used ${reuseCounts.get(e.password)}x`]);
  }
  for (const e of analysis.no2fa) {
    rows.push(["no_2fa", e.title, ""]);
  }
  // Справочно: возраст всех активных записей
  rows.push([]);
  rows.push(["Title", "Password age (days)", "Strength", "Updated"]);
  for (const e of entries.filter((x) => !x.deletedAt)) {
    const age = passwordAgeDays(e, now);
    rows.push([
      csvEscape(e.title) as unknown as string,
      age ?? "",
      e.strength,
      e.updatedAt ? new Date(e.updatedAt).toISOString() : "",
    ]);
  }

  const body = rows
    .map((r) => r.map((c) => (typeof c === "number" ? c : csvEscape(c))).join(","))
    .join("\r\n");
  return "\uFEFF" + body;
}
