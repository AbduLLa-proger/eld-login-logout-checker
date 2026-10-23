import type { DriverEvent, ParsedDriverHtml, RawStatus } from "../types";
import { cleanText, getEventType, parseOdometer } from "../utils/normalize";

type CoDriverAction = "drop" | "pickup" | null;

type CoDriverAttachment = {
  action: "drop" | "pickup";
  dateTime: string;
};

const hasChangeTruckText = (value: string): boolean => {
  const normalized = cleanText(value);

  return /\bchange[\s-]+(?:truck|truk|truc|trck|track)\b/i.test(normalized);
};

const getCoDriverAction = (value: string): CoDriverAction => {
  /*
   * Сначала проверяем действие ПЕРЕД Co Driver.
   *
   * Поддерживает:
   *
   * Drop Co Driver
   * Drop Co-Driver
   * Drop-Co-Driver
   * DropCoDriver
   *
   * Pick Co Driver
   * Pick-Co-Driver
   * PickCoDriver
   *
   * Pick Up Co Driver
   * Pick-Up-Co-Driver
   * PickupCoDriver
   */
  const dropBeforeMatch = /\bdrop[\s-]*co[\s-]*driver\b/i.test(value);

  if (dropBeforeMatch) {
    return "drop";
  }

  const pickupBeforeMatch = /\bpick(?:[\s-]*up)?[\s-]*co[\s-]*driver\b/i.test(
    value,
  );

  if (pickupBeforeMatch) {
    return "pickup";
  }

  /*
   * Если перед Co Driver действия нет,
   * ищем сам Co Driver и смотрим ПОСЛЕ него.
   */
  const coDriverMatch = /\bco[\s-]*driver\b/i.exec(value);

  if (!coDriverMatch) {
    return null;
  }

  const after = value
    .slice(coDriverMatch.index + coDriverMatch[0].length)
    .trim();

  /*
   * Co Driver Drop
   * Co-Driver, Drop
   *
   * Co Driver Pick
   * Co Driver Pickup
   * Co Driver Pick Up
   */
  const afterMatch = after.match(/^[\s,;:.-]*(drop|pick(?:[\s-]*up)?)\b/i);

  if (!afterMatch) {
    return null;
  }

  const action = afterMatch[1]!.toLowerCase();

  if (action === "drop") {
    return "drop";
  }

  return "pickup";
};

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

  const statuses: Array<
    RawStatus & {
      hasChangeTruckIcon: boolean;
    }
  > = rowNodes.map((row, originalIndex) => {
    const cells = [...row.children];

    const hasChangeTruckIcon = Boolean(
      row.querySelector('img[src*="truck-fast_black"]'),
    );

    return {
      originalIndex,
      time: getTime(cells),
      event: getEvent(row, cells),
      location: getLocation(row, cells),
      odometer: getOdometer(cells),
      notes: getNotes(cells),
      hasChangeTruckIcon,
    };
  });

  const hasChangeTruck = (
    status: RawStatus & {
      hasChangeTruckIcon: boolean;
    },
  ): boolean => status.hasChangeTruckIcon || hasChangeTruckText(status.notes);

  const formatCoDriverDateTime = (time: string): string => {
    const normalized = cleanText(time);

    const match = normalized.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(.+)$/);

    if (!match) {
      return normalized;
    }

    const [, monthShort, day, timePart] = match;

    const months: Record<string, string> = {
      Jan: "January",
      Feb: "February",
      Mar: "March",
      Apr: "April",
      May: "May",
      Jun: "June",
      Jul: "July",
      Aug: "August",
      Sep: "September",
      Oct: "October",
      Nov: "November",
      Dec: "December",
    };

    const month = months[monthShort!] ?? monthShort;

    return `${day} ${month}, ${timePart}`;
  };

  const findPreviousLoginIndex = (index: number): number | null => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const status = statuses[i];

      if (!status) {
        continue;
      }

      if (getEventType(status.event) === "login") {
        return i;
      }
    }

    return null;
  };

  const findNextLogoutIndex = (index: number): number | null => {
    for (let i = index + 1; i < statuses.length; i += 1) {
      const status = statuses[i];

      if (!status) {
        continue;
      }

      if (getEventType(status.event) === "logout") {
        return i;
      }
    }

    return null;
  };

  const coDriverEventsByAuthIndex = new Map<number, CoDriverAttachment[]>();

  statuses.forEach((status, index) => {
    const action = getCoDriverAction(status.notes);

    if (!action) {
      return;
    }

    /*
     * DROP CO DRIVER:
     * прикрепляем к Login, который был ДО него.
     *
     * PICK CO DRIVER:
     * прикрепляем к Logout, который идёт ПОСЛЕ него.
     */
    const authIndex =
      action === "drop"
        ? findPreviousLoginIndex(index)
        : findNextLogoutIndex(index);

    if (authIndex === null) {
      return;
    }

    const existingEvents = coDriverEventsByAuthIndex.get(authIndex) ?? [];

    existingEvents.push({
      action,
      dateTime: formatCoDriverDateTime(status.time),
    });

    coDriverEventsByAuthIndex.set(authIndex, existingEvents);
  });

  const hasNearbyChangeTruck = (
    index: number,
    type: DriverEvent["type"],
    odometer: number | null,
  ): boolean => {
    if (odometer == null) {
      return false;
    }

    const currentStatus = statuses[index];

    if (!currentStatus) {
      return false;
    }

    // change truck прямо на Login / Logout
    if (
      currentStatus.odometer === odometer &&
      hasChangeTruckText(currentStatus.notes)
    ) {
      return true;
    }

    // Login -> ищем после
    // Logout -> ищем перед
    const direction = type === "login" ? 1 : -1;

    const MAX_DISTANCE = 3;

    for (let distance = 1; distance <= MAX_DISTANCE; distance += 1) {
      const status = statuses[index + direction * distance];

      if (!status) {
        break;
      }

      // Другой Login / Logout = уже другая группа
      if (getEventType(status.event)) {
        break;
      }

      if (status.odometer === odometer && hasChangeTruckText(status.notes)) {
        return true;
      }
    }

    return false;
  };

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

      const coDriverEvents = coDriverEventsByAuthIndex.get(index) ?? [];

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
      let locationUnavailableReason: "range-start" | "range-end" | undefined;

      if (!location) {
        if (type === "logout") {
          location = findLocationBefore(index);

          if (!location) {
            locationUnavailableReason = "range-start";
          }
        } else {
          location = findLocationAfter(index);

          if (!location) {
            locationUnavailableReason = "range-end";
          }
        }
      }

      const changeTruck = hasNearbyChangeTruck(index, type, status.odometer);

      return {
        ...status,
        type,
        event: type === "login" ? "Login" : "Logout",
        location,
        locationUnavailableReason,
        hasChangeTruck: changeTruck,
        coDriverEvents,
      };
    })
    .filter((event): event is DriverEvent => event !== null);

  return {
    statuses,
    authEvents,
  };
};
