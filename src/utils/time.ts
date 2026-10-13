import type { DriverEvent, ParsedFlowTime } from "../types";
import { cleanText } from "./normalize";

const MONTH_INDEX: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export interface EventSequence {
  label: string;
  state: "valid" | "invalid" | "same" | "unknown";
}

export const parseFlowTime = (value = ""): ParsedFlowTime | null => {
  const match = cleanText(value).match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2}):(\d{2})\s+([AP]M)[A-Za-z]*$/i,
  );

  if (!match) return null;

  const [, monthName, dayText, hourText, minuteText, secondText, meridiemRaw] =
    match;
  if (
    !monthName ||
    !dayText ||
    !hourText ||
    !minuteText ||
    !secondText ||
    !meridiemRaw
  ) {
    return null;
  }

  const month = MONTH_INDEX[monthName.toLowerCase()];
  if (month == null) return null;

  const day = Number(dayText);
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const meridiem = meridiemRaw.toUpperCase();

  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;

  // A fixed leap year is enough for ordering inside FlowConnect's short window.
  return {
    month,
    day,
    timestamp: Date.UTC(2000, month, day, hour, minute, second),
  };
};

export const getEventTimelineTimestamp = (
  event: DriverEvent,
  crossesNewYear = false,
): number | null => {
  const parsed = parseFlowTime(event.time);

  if (!parsed) {
    return null;
  }

  if (!crossesNewYear || parsed.month !== 0) {
    return parsed.timestamp;
  }

  const date = new Date(parsed.timestamp);

  return Date.UTC(
    2001,
    parsed.month,
    parsed.day,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
};

const getComparableTimestamps = (
  first: DriverEvent,
  second: DriverEvent,
): { firstTimestamp: number; secondTimestamp: number } | null => {
  const firstTime = parseFlowTime(first.time);
  const secondTime = parseFlowTime(second.time);

  if (!firstTime || !secondTime) return null;

  let firstTimestamp = firstTime.timestamp;
  let secondTimestamp = secondTime.timestamp;

  // Handle an 8-day window crossing New Year: Dec 31 -> Jan 1.
  // January belongs to the next year whenever the compared pair spans Dec/Jan.
  if (firstTime.month === 11 && secondTime.month === 0) {
    const secondDate = new Date(secondTimestamp);
    secondTimestamp = Date.UTC(
      2001,
      secondTime.month,
      secondTime.day,
      secondDate.getUTCHours(),
      secondDate.getUTCMinutes(),
      secondDate.getUTCSeconds(),
    );
  } else if (firstTime.month === 0 && secondTime.month === 11) {
    const firstDate = new Date(firstTimestamp);
    firstTimestamp = Date.UTC(
      2001,
      firstTime.month,
      firstTime.day,
      firstDate.getUTCHours(),
      firstDate.getUTCMinutes(),
      firstDate.getUTCSeconds(),
    );
  }

  return { firstTimestamp, secondTimestamp };
};

export const compareLogoutLoginTime = (
  logout: DriverEvent,
  login: DriverEvent,
): boolean | null => {
  const timestamps = getComparableTimestamps(logout, login);
  if (!timestamps) return null;

  // Handoff rule: Logout happens first; the other driver must Login later.
  return timestamps.secondTimestamp > timestamps.firstTimestamp;
};
