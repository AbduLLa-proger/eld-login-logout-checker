import "./styles.css";

import { compareDrivers } from "./comparison/compareDrivers";
import { parseDriverHtml } from "./parser/parseDriverHtml";
import { getElement } from "./ui/dom";
import { renderComparison } from "./ui/render";

type Theme = "light" | "dark";

const inputGrid = getElement<HTMLElement>("#inputGrid");

const firstHtml = getElement<HTMLTextAreaElement>("#firstHtml");

const secondHtml = getElement<HTMLTextAreaElement>("#secondHtml");

const thirdHtml = getElement<HTMLTextAreaElement>("#thirdHtml");

const firstMeta = getElement<HTMLElement>("#firstMeta");

const secondMeta = getElement<HTMLElement>("#secondMeta");

const thirdMeta = getElement<HTMLElement>("#thirdMeta");

const thirdDriverCard = getElement<HTMLElement>("#thirdDriverCard");

const toggleThirdDriver = getElement<HTMLButtonElement>("#toggleThirdDriver");

const compareButton = getElement<HTMLButtonElement>("#compareButton");

const clearAll = getElement<HTMLButtonElement>("#clearAll");

const results = getElement<HTMLElement>("#results");

const message = getElement<HTMLElement>("#message");

const comparisonHeader = getElement<HTMLElement>("#comparisonHeader");

const comparisonRows = getElement<HTMLElement>("#comparisonRows");

const matchedCount = getElement<HTMLElement>("#matchedCount");

const mismatchCount = getElement<HTMLElement>("#mismatchCount");

const ignoredCount = getElement<HTMLElement>("#ignoredCount");

let thirdDriverEnabled = false;

const updateMeta = (input: HTMLTextAreaElement, meta: HTMLElement): void => {
  const value = input.value.trim();

  if (!value) {
    meta.textContent = "HTML не вставлен";

    return;
  }

  const matches = value.match(/events-short-table-event/g)?.length ?? 0;

  meta.textContent = matches
    ? `~${matches} status rows`
    : `${value.length.toLocaleString()} chars`;
};

const showMessage = (
  text: string,
  type: "" | "warning" | "error" = "",
): void => {
  message.textContent = text;
  message.className = `message ${type}`.trim();
};

const hideMessage = (): void => {
  message.textContent = "";
  message.className = "message hidden";
};

const setThirdDriverEnabled = (enabled: boolean): void => {
  thirdDriverEnabled = enabled;

  thirdDriverCard.classList.toggle("hidden", !enabled);

  inputGrid.classList.toggle("has-third-driver", enabled);

  toggleThirdDriver.textContent = enabled
    ? "− Remove Third Driver"
    : "+ Add Third Driver";

  toggleThirdDriver.setAttribute("aria-expanded", String(enabled));

  results.classList.add("hidden");
  hideMessage();
};

toggleThirdDriver.addEventListener("click", () => {
  setThirdDriverEnabled(!thirdDriverEnabled);
});

compareButton.addEventListener("click", () => {
  hideMessage();

  results.classList.add("hidden");

  try {
    const driverInputs = [
      {
        name: "First Driver",
        input: firstHtml,
      },
      {
        name: "Second Driver",
        input: secondHtml,
      },
      ...(thirdDriverEnabled
        ? [
            {
              name: "Third Driver",
              input: thirdHtml,
            },
          ]
        : []),
    ];

    const parsedDrivers = driverInputs.map(({ name, input }) => {
      const parsed = parseDriverHtml(input.value);

      if (!parsed.authEvents.length) {
        throw new Error(`В HTML ${name} не найдены Login/Logout.`);
      }

      return parsed;
    });

    const comparison = compareDrivers(
      parsedDrivers.map((driver) => driver.authEvents),
    );

    renderComparison(comparison, {
      results,
      comparisonHeader,
      comparisonRows,
      matchedCount,
      mismatchCount,
      ignoredCount,
    });

    if (comparison.firstSharedOdometer == null) {
      showMessage(
        "Не найден odometer, который встречается хотя бы у двух водителей среди Login/Logout. Строки показаны как neutral, потому что надёжное сравнение невозможно.",
        "warning",
      );
    }
  } catch (error: unknown) {
    showMessage(
      error instanceof Error ? error.message : "Не удалось обработать HTML.",
      "error",
    );
  }
});

clearAll.addEventListener("click", () => {
  firstHtml.value = "";
  secondHtml.value = "";
  thirdHtml.value = "";

  comparisonRows.innerHTML = "";
  comparisonHeader.innerHTML = "";

  results.classList.add("hidden");

  hideMessage();

  updateMeta(firstHtml, firstMeta);

  updateMeta(secondHtml, secondMeta);

  updateMeta(thirdHtml, thirdMeta);

  setThirdDriverEnabled(false);
});

firstHtml.addEventListener("input", () => updateMeta(firstHtml, firstMeta));

secondHtml.addEventListener("input", () => updateMeta(secondHtml, secondMeta));

thirdHtml.addEventListener("input", () => updateMeta(thirdHtml, thirdMeta));

setThirdDriverEnabled(false);

const themeToggle = document.querySelector<HTMLButtonElement>("#themeToggle");

const getInitialTheme = (): Theme => {
  const savedTheme = localStorage.getItem("theme");

  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;

  localStorage.setItem("theme", theme);

  if (themeToggle) {
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
    themeToggle.title =
      theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
  }
};

applyTheme(getInitialTheme());

themeToggle?.addEventListener("click", () => {
  const currentTheme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";

  applyTheme(currentTheme === "dark" ? "light" : "dark");
});
