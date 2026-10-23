import type { ComparisonRow, DriverComparison, DriverEvent } from "../types";
import { getEventTimelineTimestamp, parseFlowTime } from "../utils/time";
import { compareTwoDriversSequentially } from "./compareTwoDriversSequentially";
import { comparePair, isComplementary } from "./comparePair";

interface IndexedDriverEvent {
  driverIndex: number;
  event: DriverEvent;
}

const createEmptyEvents = (driverCount: number): Array<DriverEvent | null> =>
  Array.from({ length: driverCount }, () => null);

const createEventsForRow = (
  driverCount: number,
  entries: IndexedDriverEvent[],
): Array<DriverEvent | null> => {
  const events = createEmptyEvents(driverCount);

  for (const entry of entries) {
    events[entry.driverIndex] = entry.event;
  }

  return events;
};

const findRelogIndexes = (group: DriverEvent[]): Set<number> => {
  const neutral = new Set<number>();

  for (let i = 0; i < group.length - 1; i += 1) {
    const current = group[i];
    const next = group[i + 1];

    if (
      current &&
      next &&
      current.type === "logout" &&
      next.type === "login" &&
      current.odometer === next.odometer
    ) {
      neutral.add(i);
      neutral.add(i + 1);
      i += 1;
    }
  }

  return neutral;
};

const getSameDriverAlternatingPairs = (
  bucket: IndexedDriverEvent[],
  driverCount: number,
): Array<[number, number]> => {
  const pairs: Array<[number, number]> = [];

  for (let driverIndex = 0; driverIndex < driverCount; driverIndex += 1) {
    const driverEntries = bucket
      .map((entry, bucketIndex) => ({
        entry,
        bucketIndex,
      }))
      .filter(({ entry }) => entry.driverIndex === driverIndex)
      .sort(
        (a, b) => a.entry.event.originalIndex - b.entry.event.originalIndex,
      );

    for (let i = 0; i < driverEntries.length - 1; i += 1) {
      const current = driverEntries[i];
      const next = driverEntries[i + 1];

      if (!current || !next) {
        continue;
      }

      /*
       * Login -> Logout
       * или
       * Logout -> Login
       *
       * у одного водителя с тем же odometer.
       */
      if (
        current.entry.event.odometer === next.entry.event.odometer &&
        current.entry.event.type !== next.entry.event.type
      ) {
        pairs.push([current.bucketIndex, next.bucketIndex]);
      }
    }
  }

  return pairs;
};

export const compareDrivers = (drivers: DriverEvent[][]): DriverComparison => {
  const driverCount = drivers.length;

  if (driverCount < 2 || driverCount > 3) {
    throw new Error("Для сравнения должно быть 2 или 3 водителя.");
  }

  if (driverCount === 2) {
    const firstDriver = drivers[0];
    const secondDriver = drivers[1];

    if (!firstDriver || !secondDriver) {
      throw new Error("Не удалось получить события двух водителей.");
    }

    return compareTwoDriversSequentially(firstDriver, secondDriver);
  }

  const allIndexedEvents: IndexedDriverEvent[] = drivers.flatMap(
    (events, driverIndex) =>
      events.map((event) => ({
        driverIndex,
        event,
      })),
  );

  const months = allIndexedEvents
    .map(({ event }) => parseFlowTime(event.time)?.month)
    .filter((month): month is number => month != null);

  const crossesNewYear = months.includes(11) && months.includes(0);

  const numericBuckets = new Map<number, IndexedDriverEvent[]>();

  const missingOdometer: IndexedDriverEvent[] = [];

  drivers.forEach((events, driverIndex) => {
    events.forEach((event) => {
      if (event.odometer == null) {
        missingOdometer.push({
          driverIndex,
          event,
        });

        return;
      }

      const bucket = numericBuckets.get(event.odometer) ?? [];

      bucket.push({
        driverIndex,
        event,
      });

      numericBuckets.set(event.odometer, bucket);
    });
  });

  const numericOdometers = [...numericBuckets.keys()].sort((a, b) => a - b);

  /*
   * Первый odometer, который встречается
   * минимум у двух разных водителей.
   */
  const firstSharedOdometer =
    numericOdometers.find((odometer) => {
      const bucket = numericBuckets.get(odometer) ?? [];

      const driverIndexes = new Set(bucket.map((entry) => entry.driverIndex));

      return driverIndexes.size >= 2;
    }) ?? null;

  const output: ComparisonRow[] = [];

  const getRowTimestamp = (row: ComparisonRow): number => {
    const timestamps = row.events
      .filter((event): event is DriverEvent => event != null)
      .map((event) => getEventTimelineTimestamp(event, crossesNewYear))
      .filter((timestamp): timestamp is number => timestamp != null);

    if (!timestamps.length) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(...timestamps);
  };

  const emitSingleDriverGroup = (
    entries: IndexedDriverEvent[],
    odometer: number,
  ): void => {
    if (!entries.length) return;

    const driverIndex = entries[0]?.driverIndex ?? 0;

    const group = entries
      .map((entry) => entry.event)
      .sort((a, b) => a.originalIndex - b.originalIndex);

    const relogIndexes = findRelogIndexes(group);

    const beforeShared =
      firstSharedOdometer != null && odometer < firstSharedOdometer;

    group.forEach((event, index) => {
      let state: ComparisonRow["state"] = "mismatch";

      let reason = "Нет соответствующего события у другого водителя";

      if (firstSharedOdometer == null) {
        state = "neutral";
        reason = "Нет общего odometer: недостаточно данных для сравнения";
      } else if (beforeShared) {
        state = "neutral";
        reason = "Начало 8-day window";
      } else if (relogIndexes.has(index)) {
        state = "neutral";
        reason = "Login/Logout одного водителя с тем же odometer";
      }

      output.push({
        events: createEventsForRow(driverCount, [
          {
            driverIndex,
            event,
          },
        ]),
        state,
        reason,
        odometer,
        order: event.originalIndex,
      });
    });
  };

  for (const odometer of numericOdometers) {
    const bucket = numericBuckets.get(odometer) ?? [];

    const involvedDrivers = new Set(bucket.map((entry) => entry.driverIndex));

    /*
     * На этом odometer есть события
     * только одного водителя.
     */
    if (involvedDrivers.size === 1) {
      emitSingleDriverGroup(bucket, odometer);

      continue;
    }

    /*
     * Здесь уже минимум 2 водителя.
     *
     * Сначала пытаемся найти настоящие
     * Logout -> Login пары между
     * РАЗНЫМИ водителями.
     */

    const used = new Set<number>();

    for (let sourceIndex = 0; sourceIndex < bucket.length; sourceIndex += 1) {
      if (used.has(sourceIndex)) {
        continue;
      }

      const source = bucket[sourceIndex];

      if (!source) continue;

      const candidates = bucket
        .map((entry, index) => ({
          entry,
          index,
        }))
        .filter(
          ({ entry, index }) =>
            index !== sourceIndex &&
            !used.has(index) &&
            entry.driverIndex !== source.driverIndex &&
            isComplementary(source.event, entry.event),
        );

      if (!candidates.length) {
        continue;
      }

      /*
       * Если среди нескольких водителей
       * есть полностью правильная пара,
       * выбираем её первой.
       *
       * Например:
       *
       * Driver 1 Logout
       * Driver 2 Login — location wrong
       * Driver 3 Login — всё совпадает
       *
       * Тогда Driver 1 будет сопоставлен
       * именно с Driver 3.
       */
      const perfectCandidates = candidates.filter(
        ({ entry }) => comparePair(source.event, entry.event).state === "match",
      );

      const candidatePool =
        perfectCandidates.length > 0 ? perfectCandidates : candidates;

      const sourceTimestamp = getEventTimelineTimestamp(
        source.event,
        crossesNewYear,
      );

      const selected = candidatePool.reduce(
        (best, candidate) => {
          if (!best) {
            return candidate;
          }

          const candidateTimestamp = getEventTimelineTimestamp(
            candidate.entry.event,
            crossesNewYear,
          );

          const bestTimestamp = getEventTimelineTimestamp(
            best.entry.event,
            crossesNewYear,
          );

          if (sourceTimestamp == null || candidateTimestamp == null) {
            return best;
          }

          if (bestTimestamp == null) {
            return candidate;
          }

          const candidateDistance = Math.abs(
            sourceTimestamp - candidateTimestamp,
          );

          const bestDistance = Math.abs(sourceTimestamp - bestTimestamp);

          return candidateDistance < bestDistance ? candidate : best;
        },
        undefined as (typeof candidatePool)[number] | undefined,
      );

      if (!selected) {
        continue;
      }

      used.add(sourceIndex);
      used.add(selected.index);

      const result = comparePair(source.event, selected.entry.event);

      output.push({
        events: createEventsForRow(driverCount, [source, selected.entry]),
        ...result,
        odometer,
        order: Math.min(
          source.event.originalIndex,
          selected.entry.event.originalIndex,
        ),
      });
    }

    /*
     * Остались события, которым не
     * нашлась Login/Logout пара.
     */
    const remaining = bucket
      .map((entry, index) => ({
        entry,
        index,
      }))
      .filter(({ index }) => !used.has(index));

    const sameDriverPairs = getSameDriverAlternatingPairs(bucket, driverCount);

    const remainingIndexes = new Set(remaining.map(({ index }) => index));

    const neutralBucketIndexes = new Set<number>();

    for (const [firstIndex, secondIndex] of sameDriverPairs) {
      /*
       * Same-driver исключение применяем только если
       * ОБА события ещё не использованы в настоящей
       * паре между разными водителями.
       */
      if (
        remainingIndexes.has(firstIndex) &&
        remainingIndexes.has(secondIndex)
      ) {
        neutralBucketIndexes.add(firstIndex);
        neutralBucketIndexes.add(secondIndex);
      }
    }

    const remainingUsed = new Set<number>();

    remaining.forEach(({ entry, index }, remainingIndex) => {
      if (!neutralBucketIndexes.has(index)) {
        return;
      }

      remainingUsed.add(remainingIndex);

      output.push({
        events: createEventsForRow(driverCount, [entry]),
        state: "neutral",
        reason: "Login/Logout одного водителя с тем же odometer — допустимо",
        odometer,
        order: entry.event.originalIndex,
      });
    });

    /*
     * Если у двух разных водителей
     * одинаковый тип:
     *
     * Logout + Logout
     * Login + Login
     *
     * показываем их в одной строке,
     * чтобы было видно расхождение.
     */
    for (let i = 0; i < remaining.length; i += 1) {
      if (remainingUsed.has(i)) {
        continue;
      }

      const first = remaining[i];

      if (!first) continue;

      const secondIndex = remaining.findIndex(
        (candidate, index) =>
          index !== i &&
          !remainingUsed.has(index) &&
          candidate.entry.driverIndex !== first.entry.driverIndex,
      );

      if (secondIndex === -1) {
        continue;
      }

      const second = remaining[secondIndex];

      if (!second) continue;

      remainingUsed.add(i);
      remainingUsed.add(secondIndex);

      const result = comparePair(first.entry.event, second.entry.event);

      output.push({
        events: createEventsForRow(driverCount, [first.entry, second.entry]),
        ...result,
        odometer,
        order: Math.min(
          first.entry.event.originalIndex,
          second.entry.event.originalIndex,
        ),
      });
    }

    /*
     * Всё, что осталось вообще без пары.
     */
    remaining.forEach(({ entry }, index) => {
      if (remainingUsed.has(index)) {
        return;
      }

      output.push({
        events: createEventsForRow(driverCount, [entry]),
        state: "mismatch",
        reason: "Нет соответствующего Login/Logout у другого водителя",
        odometer,
        order: entry.event.originalIndex,
      });
    });
  }

  /*
   * Login / Logout без odometer.
   */
  missingOdometer.forEach((entry) => {
    output.push({
      events: createEventsForRow(driverCount, [entry]),
      state: "mismatch",
      reason: "У Login/Logout отсутствует odometer",
      odometer: Number.POSITIVE_INFINITY,
      order: entry.event.originalIndex,
    });
  });

  /*
   * После того как все пары уже сформированы,
   * проверяем, нет ли другого Login / Logout
   * между временем найденной пары.
   */
  const rowsWithSequenceWarnings = output.map((row): ComparisonRow => {
    const pairEvents = row.events.filter(
      (event): event is DriverEvent => event != null,
    );

    /*
     * Проверяем только строки, где есть
     * ровно два события.
     */
    if (pairEvents.length !== 2) {
      return row;
    }

    const first = pairEvents[0];
    const second = pairEvents[1];

    if (!first || !second) {
      return row;
    }

    /*
     * Login + Login или Logout + Logout
     * здесь не проверяем.
     *
     * Нам нужна именно Login <-> Logout пара.
     */
    if (!isComplementary(first, second)) {
      return row;
    }

    const firstTimestamp = getEventTimelineTimestamp(first, crossesNewYear);

    const secondTimestamp = getEventTimelineTimestamp(second, crossesNewYear);

    if (firstTimestamp == null || secondTimestamp == null) {
      return row;
    }

    const startTimestamp = Math.min(firstTimestamp, secondTimestamp);

    const endTimestamp = Math.max(firstTimestamp, secondTimestamp);

    const startEvent = firstTimestamp <= secondTimestamp ? first : second;

    const endEvent = firstTimestamp <= secondTimestamp ? second : first;

    /*
     * Ищем ВСЕ Login / Logout всех водителей,
     * которые произошли строго между
     * двумя событиями текущей пары.
     */
    const eventsBetween = allIndexedEvents
      .filter(({ event }) => {
        if (event === first || event === second) {
          return false;
        }

        if (event.odometer == null) {
          return false;
        }

        const timestamp = getEventTimelineTimestamp(event, crossesNewYear);

        if (timestamp == null) {
          return false;
        }

        return timestamp > startTimestamp && timestamp < endTimestamp;
      })
      .sort((a, b) => {
        const aTimestamp =
          getEventTimelineTimestamp(a.event, crossesNewYear) ??
          Number.POSITIVE_INFINITY;

        const bTimestamp =
          getEventTimelineTimestamp(b.event, crossesNewYear) ??
          Number.POSITIVE_INFINITY;

        return aTimestamp - bTimestamp;
      });

    if (!eventsBetween.length) {
      return row;
    }

    const details = eventsBetween
      .map(
        ({ driverIndex, event }) =>
          `Driver ${driverIndex + 1}: ${event.event} ${event.odometer} (${event.time})`,
      )
      .join("; ");

    return {
      ...row,
      reason:
        `${row.reason} · ` +
        `⚠ Между ${startEvent.event} ${startEvent.time} ` +
        `и ${endEvent.event} ${endEvent.time} ` +
        `найдено другое Login/Logout с odometer: ${details}`,
    };
  });

  /*
   * Сопоставление уже завершено.
   *
   * Теперь только сортируем ГОТОВЫЙ результат
   * по дате и времени.
   */
  const sortedRows = rowsWithSequenceWarnings.sort((a, b) => {
    const timeDifference = getRowTimestamp(a) - getRowTimestamp(b);

    if (timeDifference !== 0) {
      return timeDifference;
    }

    return a.order - b.order;
  });

  return {
    rows: sortedRows,
    firstSharedOdometer,
    driverCount,
  };
};
