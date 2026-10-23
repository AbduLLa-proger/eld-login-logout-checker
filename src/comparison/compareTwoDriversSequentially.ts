import type {
  ComparisonRow,
  DriverComparison,
  DriverEvent,
  PairResult,
} from "../types";
import { comparePair } from "./comparePair";

type AlignmentMove = "pair" | "first-only" | "second-only";

interface AlignmentStep {
  move: AlignmentMove;
  firstIndex: number | null;
  secondIndex: number | null;
}

const GAP_SCORE = -3;

/*
 * Полностью правильная пара получает больший вес.
 *
 * Это важно в ситуации:
 *
 * Driver 1:
 * Logout 123
 *
 * Driver 2:
 * Login 123 с неправильной location
 * Login 123 с правильной location
 *
 * Тогда алгоритм предпочтет второй Login.
 */
const FULL_MATCH_SCORE = 20;

/*
 * Odometer + противоположный event совпадают,
 * но location/time могут содержать ошибку.
 *
 * Такую пару всё равно считаем логически связанной.
 */
const STRUCTURAL_MATCH_SCORE = 8;

const createEmptyEvents = (): Array<DriverEvent | null> => [null, null];

const createRowEvents = (
  first: DriverEvent | null,
  second: DriverEvent | null,
): Array<DriverEvent | null> => {
  const events = createEmptyEvents();

  events[0] = first;
  events[1] = second;

  return events;
};

const hasCoDriverAction = (
  events: Array<DriverEvent | null>,
  action: "drop" | "pickup",
): boolean =>
  events.some(
    (event) =>
      event?.coDriverEvents?.some(
        (coDriverEvent) => coDriverEvent.action === action,
      ) ?? false,
  );

/*
 * Это не означает, что пара полностью правильная.
 *
 * Это означает только:
 *
 * Logout <-> Login
 * +
 * одинаковый odometer.
 *
 * Location и время проверит comparePair().
 */
const isStructuralPair = (first: DriverEvent, second: DriverEvent): boolean => {
  return (
    first.odometer != null &&
    second.odometer != null &&
    first.odometer === second.odometer &&
    first.type !== second.type
  );
};

const getAlignmentScore = (
  first: DriverEvent,
  second: DriverEvent,
): number | null => {
  if (!isStructuralPair(first, second)) {
    return null;
  }

  const result = comparePair(first, second);

  return result.state === "match" ? FULL_MATCH_SCORE : STRUCTURAL_MATCH_SCORE;
};

/*
 * Ищем лучшую последовательную цепочку,
 * НЕ меняя порядок событий.
 *
 * По сути:
 *
 * HTML 1: A B   C D
 * HTML 2: A X B C D
 *
 * Получим:
 *
 * A <-> A
 *       X extra
 * B <-> B
 * C <-> C
 * D <-> D
 */
const buildAlignment = (
  firstEvents: DriverEvent[],
  secondEvents: DriverEvent[],
): AlignmentStep[] => {
  const firstLength = firstEvents.length;
  const secondLength = secondEvents.length;

  const scores = Array.from({ length: firstLength + 1 }, () =>
    Array<number>(secondLength + 1).fill(Number.NEGATIVE_INFINITY),
  );

  const moves = Array.from({ length: firstLength + 1 }, () =>
    Array<AlignmentMove | null>(secondLength + 1).fill(null),
  );

  scores[0]![0] = 0;

  for (let i = 1; i <= firstLength; i += 1) {
    scores[i]![0] = scores[i - 1]![0]! + GAP_SCORE;
    moves[i]![0] = "first-only";
  }

  for (let j = 1; j <= secondLength; j += 1) {
    scores[0]![j] = scores[0]![j - 1]! + GAP_SCORE;
    moves[0]![j] = "second-only";
  }

  for (let i = 1; i <= firstLength; i += 1) {
    for (let j = 1; j <= secondLength; j += 1) {
      const first = firstEvents[i - 1];
      const second = secondEvents[j - 1];

      if (!first || !second) {
        continue;
      }

      let bestScore = scores[i - 1]![j]! + GAP_SCORE;

      let bestMove: AlignmentMove = "first-only";

      const secondOnlyScore = scores[i]![j - 1]! + GAP_SCORE;

      if (secondOnlyScore > bestScore) {
        bestScore = secondOnlyScore;
        bestMove = "second-only";
      }

      const pairScore = getAlignmentScore(first, second);

      if (pairScore != null) {
        const diagonalScore = scores[i - 1]![j - 1]! + pairScore;

        /*
         * При равенстве предпочитаем настоящую пару.
         */
        if (diagonalScore >= bestScore) {
          bestScore = diagonalScore;
          bestMove = "pair";
        }
      }

      scores[i]![j] = bestScore;
      moves[i]![j] = bestMove;
    }
  }

  const reversedSteps: AlignmentStep[] = [];

  let i = firstLength;
  let j = secondLength;

  while (i > 0 || j > 0) {
    const move = moves[i]?.[j] ?? null;

    if (move === "pair" && i > 0 && j > 0) {
      reversedSteps.push({
        move: "pair",
        firstIndex: i - 1,
        secondIndex: j - 1,
      });

      i -= 1;
      j -= 1;

      continue;
    }

    if (move === "first-only" && i > 0) {
      reversedSteps.push({
        move: "first-only",
        firstIndex: i - 1,
        secondIndex: null,
      });

      i -= 1;

      continue;
    }

    if (j > 0) {
      reversedSteps.push({
        move: "second-only",
        firstIndex: null,
        secondIndex: j - 1,
      });

      j -= 1;

      continue;
    }

    if (i > 0) {
      reversedSteps.push({
        move: "first-only",
        firstIndex: i - 1,
        secondIndex: null,
      });

      i -= 1;
    }
  }

  return reversedSteps.reverse();
};

/*
 * Login -> Logout -> Login
 *
 * или
 *
 * Logout -> Login -> Logout
 *
 * с одинаковым odometer у одного водителя
 * считаем допустимым.
 */
const findSameDriverAlternatingIndexes = (
  events: DriverEvent[],
): Set<number> => {
  const neutralIndexes = new Set<number>();

  for (let i = 0; i < events.length - 1; i += 1) {
    const current = events[i];
    const next = events[i + 1];

    if (!current || !next) {
      continue;
    }

    if (
      current.odometer != null &&
      current.odometer === next.odometer &&
      current.type !== next.type
    ) {
      neutralIndexes.add(i);
      neutralIndexes.add(i + 1);
    }
  }

  return neutralIndexes;
};

const compareEvents = (first: DriverEvent, second: DriverEvent): PairResult => {
  const reasons: string[] = [];

  if (first.odometer == null) {
    reasons.push("У First Driver отсутствует odometer");
  }

  if (second.odometer == null) {
    reasons.push("У Second Driver отсутствует odometer");
  }

  if (reasons.length) {
    return {
      state: "mismatch",
      reason: reasons.join(" · "),
    };
  }

  return comparePair(first, second);
};

const getRowOdometer = (
  first: DriverEvent | null,
  second: DriverEvent | null,
): number => {
  if (
    first?.odometer != null &&
    second?.odometer != null &&
    first.odometer === second.odometer
  ) {
    return first.odometer;
  }

  return first?.odometer ?? second?.odometer ?? Number.POSITIVE_INFINITY;
};

export const compareTwoDriversSequentially = (
  firstEvents: DriverEvent[],
  secondEvents: DriverEvent[],
): DriverComparison => {
  /*
   * ВАЖНО:
   *
   * Здесь НЕТ sort().
   *
   * Используем события ровно в том порядке,
   * в котором parseDriverHtml() получил их из HTML.
   */
  const alignment = buildAlignment(firstEvents, secondEvents);

  const firstRelogIndexes = findSameDriverAlternatingIndexes(firstEvents);

  const secondRelogIndexes = findSameDriverAlternatingIndexes(secondEvents);

  const hasAlignedPair = alignment.some((step) => step.move === "pair");

  const rows: ComparisonRow[] = [];

  let order = 0;

  let coDriversSeparated = false;

  let firstSharedOdometer: number | null = null;

  let hasSeenAlignedPair = false;

  let pendingFirstIndexes: number[] = [];
  let pendingSecondIndexes: number[] = [];

  const applyCoDriverState = (
    events: Array<DriverEvent | null>,
    state: ComparisonRow["state"],
    reason: string,
  ): {
    state: ComparisonRow["state"];
    reason: string;
  } => {
    const hasPickup = hasCoDriverAction(events, "pickup");

    const hasDrop = hasCoDriverAction(events, "drop");

    /*
     * Pick Co Driver:
     * с этой строки водители снова едут вместе.
     */
    if (hasPickup) {
      coDriversSeparated = false;
    }

    /*
     * Если Drop уже произошёл раньше,
     * сравнение двух водителей временно отключаем.
     */
    const result = coDriversSeparated
      ? {
          state: "neutral" as const,
          reason: "После Drop Co Driver — водители едут отдельно",
        }
      : {
          state,
          reason,
        };

    /*
     * Drop Co Driver:
     * сама строка Drop ещё относится
     * к предыдущей общей цепочке.
     *
     * Разделение начинается со следующей строки.
     */
    if (hasDrop) {
      coDriversSeparated = true;
    }

    return result;
  };

  const pushSingle = (
    driverIndex: 0 | 1,
    eventIndex: number,
    isBeginningWindow: boolean,
  ): void => {
    const event =
      driverIndex === 0 ? firstEvents[eventIndex] : secondEvents[eventIndex];

    if (!event) {
      return;
    }

    const relogIndexes =
      driverIndex === 0 ? firstRelogIndexes : secondRelogIndexes;

    let state: ComparisonRow["state"] = "mismatch";
    let reason = "Лишний Login/Logout: нарушает последовательную цепочку";

    if (event.odometer == null) {
      state = "mismatch";
      reason = "У Login/Logout отсутствует odometer";
    } else if (relogIndexes.has(eventIndex)) {
      state = "neutral";
      reason = "Login/Logout одного водителя с тем же odometer — допустимо";
    } else if (isBeginningWindow) {
      /*
       * Самое начало 8-day window.
       *
       * Парный Login/Logout мог остаться
       * за пределами загруженных 8 дней.
       */
      state = "neutral";
      reason = "Начало 8-day window";
    }

    const events = createRowEvents(
      driverIndex === 0 ? event : null,
      driverIndex === 1 ? event : null,
    );

    const result = applyCoDriverState(events, state, reason);

    rows.push({
      events,
      state: result.state,
      reason: result.reason,
      odometer: event.odometer ?? Number.POSITIVE_INFINITY,
      order,
    });

    order += 1;
  };

  const pushPair = (firstIndex: number, secondIndex: number): void => {
    const first = firstEvents[firstIndex];
    const second = secondEvents[secondIndex];

    if (!first || !second) {
      return;
    }

    const pairResult = compareEvents(first, second);

    if (firstSharedOdometer == null && isStructuralPair(first, second)) {
      firstSharedOdometer = first.odometer;
    }

    const events = createRowEvents(first, second);

    const result = applyCoDriverState(
      events,
      pairResult.state,
      pairResult.reason,
    );

    rows.push({
      events,
      state: result.state,
      reason: result.reason,
      odometer: getRowOdometer(first, second),
      order,
    });

    order += 1;
  };

  const flushPending = (isBeginningWindow: boolean): void => {
    let firstPointer = 0;
    let secondPointer = 0;

    while (
      firstPointer < pendingFirstIndexes.length ||
      secondPointer < pendingSecondIndexes.length
    ) {
      const firstIndex = pendingFirstIndexes[firstPointer];

      const secondIndex = pendingSecondIndexes[secondPointer];

      /*
       * Same-driver re-login/re-logout
       * не превращаем в ошибочную пару.
       */
      if (firstIndex != null && firstRelogIndexes.has(firstIndex)) {
        pushSingle(0, firstIndex, isBeginningWindow);

        firstPointer += 1;

        continue;
      }

      if (secondIndex != null && secondRelogIndexes.has(secondIndex)) {
        pushSingle(1, secondIndex, isBeginningWindow);

        secondPointer += 1;

        continue;
      }

      /*
       * Если лишнее событие есть у обоих водителей
       * на одном участке последовательности,
       * показываем их рядом.
       *
       * Например:
       *
       * Driver 1: Logout 200
       * Driver 2: Logout 999
       *
       * comparePair() покажет конкретную ошибку.
       */
      if (firstIndex != null && secondIndex != null) {
        pushPair(firstIndex, secondIndex);

        firstPointer += 1;
        secondPointer += 1;

        continue;
      }

      if (firstIndex != null) {
        pushSingle(0, firstIndex, isBeginningWindow);

        firstPointer += 1;

        continue;
      }

      if (secondIndex != null) {
        pushSingle(1, secondIndex, isBeginningWindow);

        secondPointer += 1;
      }
    }

    pendingFirstIndexes = [];
    pendingSecondIndexes = [];
  };

  for (const step of alignment) {
    if (step.move === "first-only") {
      if (step.firstIndex != null) {
        pendingFirstIndexes.push(step.firstIndex);
      }

      continue;
    }

    if (step.move === "second-only") {
      if (step.secondIndex != null) {
        pendingSecondIndexes.push(step.secondIndex);
      }

      continue;
    }

    /*
     * Нашли следующую точку общей цепочки.
     *
     * Сначала обрабатываем всё лишнее,
     * что находилось перед ней.
     */
    flushPending(!hasSeenAlignedPair && hasAlignedPair);

    if (step.firstIndex != null && step.secondIndex != null) {
      pushPair(step.firstIndex, step.secondIndex);
    }

    hasSeenAlignedPair = true;
  }

  /*
   * Всё, что осталось после последней
   * совпавшей пары.
   *
   * Это уже НЕ начало 8-day window,
   * поэтому обычные лишние события
   * считаются ошибками.
   */
  flushPending(!hasSeenAlignedPair && hasAlignedPair);

  return {
    rows,
    firstSharedOdometer,
    driverCount: 2,
  };
};
