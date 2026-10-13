import type {
  ComparisonRow,
  ComparisonState,
  DriverComparison,
  DriverEvent,
} from "../types";
import { escapeHtml } from "../utils/normalize";

export interface RenderTargets {
  results: HTMLElement;
  comparisonHeader: HTMLElement;
  comparisonRows: HTMLElement;
  matchedCount: HTMLElement;
  mismatchCount: HTMLElement;
  ignoredCount: HTMLElement;
}

const DRIVER_NAMES = ["First Driver", "Second Driver", "Third Driver"];

const renderEvent = (event: DriverEvent | null): string => {
  if (!event) {
    return '<span class="empty-cell">—</span>';
  }

  return `
    <div class="event-card">
      <span class="event-badge ${event.type}">
        ${escapeHtml(event.event)}
      </span>

      <div class="event-time">
        ${escapeHtml(event.time || "Time missing")}
      </div>

      <div class="event-location">
        ${escapeHtml(event.location || "Location not found")}
      </div>

      <div class="event-odo">
        Odometer:
        <strong>
          ${event.odometer ?? "—"}
        </strong>
      </div>
    </div>
  `;
};

const renderResult = (row: ComparisonRow): string => {
  const symbols: Record<ComparisonState, string> = {
    match: "✓",
    mismatch: "×",
    neutral: "•",
  };

  const warningSeparator = " · ⚠ ";

  const [reason, ...warningParts] = row.reason.split(warningSeparator);

  const warning =
    warningParts.length > 0 ? warningParts.join(warningSeparator) : null;

  return `
    <div
      class="result-wrap"
      title="${escapeHtml(row.reason)}"
    >
      <span class="result-icon ${row.state}">
        ${symbols[row.state]}
      </span>

      <div class="result-reason">
        ${escapeHtml(reason ?? row.reason)}
      </div>

      ${
        warning
          ? `
            <div class="result-warning">
              <strong>⚠ Warning</strong>

              <div>
                ${escapeHtml(warning)}
              </div>
            </div>
          `
          : ""
      }
    </div>
  `;
};

export const renderComparison = (
  comparison: DriverComparison,
  targets: RenderTargets,
): void => {
  targets.results.style.setProperty(
    "--driver-count",
    String(comparison.driverCount),
  );

  targets.comparisonHeader.innerHTML = `
    ${DRIVER_NAMES.slice(0, comparison.driverCount)
      .map((name) => `<div>${escapeHtml(name)}</div>`)
      .join("")}

    <div>Result</div>
  `;

  targets.comparisonRows.innerHTML = comparison.rows
    .map(
      (row) => `
          <div class="comparison-row comparison-grid-row">
            ${row.events
              .map((event) => `<div>${renderEvent(event)}</div>`)
              .join("")}

            <div class="result-cell">
              ${renderResult(row)}
            </div>
          </div>
        `,
    )
    .join("");

  const counts = comparison.rows.reduce<Record<ComparisonState, number>>(
    (accumulator, row) => {
      accumulator[row.state] += 1;
      return accumulator;
    },
    {
      match: 0,
      mismatch: 0,
      neutral: 0,
    },
  );

  targets.matchedCount.textContent = String(counts.match);

  targets.mismatchCount.textContent = String(counts.mismatch);

  targets.ignoredCount.textContent = String(counts.neutral);

  targets.results.classList.remove("hidden");
};
