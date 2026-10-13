import type { DriverEvent, ParsedDriverHtml, RawStatus } from "../types";
import { cleanText, getEventType, parseOdometer } from "../utils/normalize";

const textOf = (element: Element | undefined): string => {
  if (!element) return "";

  return cleanText(
    (element as HTMLElement).innerText || element.textContent || "",
  );
};

const ownTextOf = (element: Element | undefined): string => {
  if (!element) return "";

  const text = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ");

  return cleanText(text);
};

const isNewStructure = (cells: Element[]): boolean => cells.length >= 13;

const getTime = (cells: Element[]): string => {
  if (isNewStructure(cells)) {
    // NEW HTML:
    // 0 = icon/info
    // 1 = time
    return textOf(cells[1]);
  }

  // OLD HTML:
  // 0 = time
  return textOf(cells[0]);
};

const getEvent = (row: HTMLElement, cells: Element[]): string => {
  const eventNode =
    row.querySelector<HTMLElement>(".status-code-id") ??
    row.querySelector<HTMLElement>(".event-code-status-code");

  if (eventNode) {
    return cleanText(eventNode.textContent ?? "");
  }

  if (isNewStructure(cells)) {
    // NEW HTML
    // 3 = event
    return textOf(cells[3]);
  }

  // OLD HTML
  // 1 = event
  return textOf(cells[1]);
};

const cleanLocationText = (value: string): string => {
  return (
    cleanText(value)
      // FlowConnect warning inside Location cell
      .replace(/different\s+locations?/gi, " ")
      // Material / UI labels
      .replace(
        /(?:^|\s)(?:place|more_vert|more_horiz|content_copy|edit)(?=\s|$)/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim()
  );
};

const isValidLocationText = (value: string): boolean => {
  const normalized = cleanText(value).toLowerCase();

  if (!normalized) {
    return false;
  }

  const uiValues = new Set([
    "place",
    "more_vert",
    "more_horiz",
    "content_copy",
    "edit",
  ]);

  return !uiValues.has(normalized);
};

const getNewLocation = (row: HTMLElement, cells: Element[]): string => {
  /*
   * В новой структуре:
   *
   * 0 = info/icon
   * 1 = time
   * 2 = duration
   * 3 = event
   * 4 = status
   * 5 = location
   * 6 = origin
   * 7 = odometer
   *
   * ВАЖНО:
   * сначала берём cells[5].
   *
   * row.querySelector(".location") может в HTML,
   * полученном через virtual scroll, найти
   * неправильный вложенный UI элемент.
   */
  const locationCell =
    (cells[5] as HTMLElement | undefined) ??
    row.querySelector<HTMLElement>(".location");

  if (!locationCell) {
    return "";
  }

  /*
   * Сначала пробуем собственный текст ячейки.
   *
   * Это самый безопасный вариант:
   *
   * <div>
   *   5mi WSW from Berwick, PA
   *   <button>more_vert</button>
   * </div>
   *
   * ownTextOf() возьмёт только location.
   */
  const ownText = cleanLocationText(ownTextOf(locationCell));

  if (isValidLocationText(ownText)) {
    return ownText;
  }

  /*
   * Если location находится внутри child,
   * ищем подходящий текст там.
   */
  for (const child of [...locationCell.children]) {
    if (child.matches("button, mat-icon, input, textarea, app-copy-property")) {
      continue;
    }

    const value = cleanLocationText(textOf(child));

    if (isValidLocationText(value)) {
      return value;
    }
  }

  /*
   * Последний fallback — весь текст ячейки,
   * но очищаем UI tokens.
   */
  const fullText = cleanLocationText(textOf(locationCell));

  if (isValidLocationText(fullText)) {
    return fullText;
  }

  return "";
};

const getLocation = (row: HTMLElement, cells: Element[]): string => {
  if (isNewStructure(cells)) {
    // NEW HTML
    // 5 = location
    return getNewLocation(row, cells);
  }

  // OLD HTML
  // 3 = location
  return textOf(cells[3]);
};

const parseFirstOdometer = (value: string): number | null => {
  /*
   * В новом HTML odometer иногда выглядит так:
   *
   * 163908
   * +585
   *
   * Нам нужен только первый номер.
   */

  const normalized = cleanText(value);

  const match = normalized.match(/\d[\d,]*/);

  if (!match) {
    return null;
  }

  return parseOdometer(match[0]);
};

const getOdometer = (cells: Element[]): number | null => {
  if (!isNewStructure(cells)) {
    // OLD HTML
    // 5 = odometer
    return parseOdometer(textOf(cells[5]));
  }

  // NEW HTML
  // 7 = odometer
  const odometerCell = cells[7];

  if (!odometerCell) {
    return null;
  }

  const container = odometerCell.querySelector<HTMLElement>(
    ".error-count-container",
  );

  if (container) {
    /*
     * Берём только собственный text node контейнера.
     *
     * Например:
     *
     * <div class="error-count-container">
     *   163908
     *   <span>+585</span>
     * </div>
     *
     * ownTextOf() вернёт только 163908.
     */
    const ownText = ownTextOf(container);

    const odometer = parseFirstOdometer(ownText);

    if (odometer !== null) {
      return odometer;
    }
  }

  return parseFirstOdometer(textOf(odometerCell));
};

const getNotes = (cells: Element[]): string => {
  if (isNewStructure(cells)) {
    // NEW HTML
    // 9 = notes
    return textOf(cells[9]);
  }

  // OLD HTML
  // 7 = notes
  return textOf(cells[7]);
};

export const parseDriverHtml = (html: string): ParsedDriverHtml => {
  if (!html.trim()) {
    throw new Error("HTML не вставлен.");
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  const rowNodes = [
    ...doc.querySelectorAll<HTMLElement>(".events-short-table-event"),
  ].filter((row) => row.id !== "eventFakeStatus");

  if (!rowNodes.length) {
    throw new Error(
      "Не найдены строки .events-short-table-event. Убедитесь, что скопированы все статусы.",
    );
  }

  const statuses: RawStatus[] = rowNodes.map((row, originalIndex) => {
    const cells = [...row.children];

    return {
      originalIndex,
      time: getTime(cells),
      event: getEvent(row, cells),
      location: getLocation(row, cells),
      odometer: getOdometer(cells),
      notes: getNotes(cells),
    };
  });

  const findLocationBefore = (index: number): string => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const status = statuses[i];

      if (status?.location) {
        return status.location;
      }
    }

    return "";
  };

  const findLocationAfter = (index: number): string => {
    for (let i = index + 1; i < statuses.length; i += 1) {
      const status = statuses[i];

      if (status?.location) {
        return status.location;
      }
    }

    return "";
  };

  const authEvents = statuses
    .map<DriverEvent | null>((status, index) => {
      const type = getEventType(status.event);

      if (!type) {
        return null;
      }

      /*
       * Если Login / Logout уже имеет location,
       * используем его.
       *
       * И только если location пустой:
       *
       * Logout -> ищем выше
       * Login  -> ищем ниже
       */
      let location = status.location;

      if (!location) {
        location =
          type === "logout"
            ? findLocationBefore(index)
            : findLocationAfter(index);
      }

      return {
        ...status,
        type,
        event: type === "login" ? "Login" : "Logout",
        location,
      };
    })
    .filter((event): event is DriverEvent => event !== null);

  return {
    statuses,
    authEvents,
  };
};
