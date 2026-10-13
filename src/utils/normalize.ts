import type { DriverEventType } from "../types";

export const cleanText = (value = ""): string =>
  value.replace(/\s+/g, " ").trim();

export const getTextDifferencePercent = (
  firstValue: string,
  secondValue: string,
): number => {
  const first = normalizeLocation(firstValue);
  const second = normalizeLocation(secondValue);

  if (first === second) {
    return 0;
  }

  if (!first || !second) {
    return 100;
  }

  const rows = first.length + 1;
  const columns = second.length + 1;

  const matrix = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );

  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j < columns; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1;

      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  const distance = matrix[first.length]?.[second.length] ?? 0;

  const maxLength = Math.max(first.length, second.length);

  return (distance / maxLength) * 100;
};

export const locationsMatch = (first: string, second: string): boolean => {
  return getTextDifferencePercent(first, second) < 40;
};

export const normalizeEvent = (value = ""): string =>
  cleanText(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

export const normalizeLocation = (value = ""): string =>
  value
    .normalize("NFKC")
    // Invisible Unicode characters from FlowConnect.
    .replace(
      /[\u200B-\u200D\u2060\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
      "",
    )
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/\s*,\s*/g, ",")
    // 3.0mi -> 3mi
    // 13.00mi -> 13mi
    .replace(/\b(\d+)\.0+\s*mi\b/g, "$1mi")
    // 3 mi -> 3mi
    // 3.5 mi -> 3.5mi
    .replace(/\b(\d+(?:\.\d+)?)\s+mi\b/g, "$1mi")
    .trim();

export const getEventType = (value: string): DriverEventType | null => {
  const normalized = normalizeEvent(value);
  if (normalized === "login") return "login";
  if (normalized === "logout") return "logout";
  return null;
};

export const parseOdometer = (value: string): number | null => {
  const normalized = cleanText(value).replace(/,/g, "");
  if (!normalized) return null;

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

export const escapeHtml = (value = ""): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
