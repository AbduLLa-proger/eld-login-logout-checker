import type { DriverEvent, PairResult } from "../types";

import { locationsMatch } from "../utils/normalize";
import { compareLogoutLoginTime } from "../utils/time";

export const isComplementary = (
  left: DriverEvent | null | undefined,
  right: DriverEvent | null | undefined,
): boolean => Boolean(left && right && left.type !== right.type);

export const comparePair = (
  left: DriverEvent,
  right: DriverEvent,
): PairResult => {
  const reasons: string[] = [];

  if (!isComplementary(left, right)) {
    reasons.push("Login/Logout pair не сходится");
  }

  if (left.odometer !== right.odometer) {
    reasons.push("Odometer отличается");
  }

  /*
   * Location считается ошибкой только если
   * текст отличается на 40% или больше.
   */
  if (!locationsMatch(left.location, right.location)) {
    reasons.push("Location отличается");
  }

  if (isComplementary(left, right)) {
    const logout = left.type === "logout" ? left : right;

    const login = left.type === "login" ? left : right;

    const timeIsValid = compareLogoutLoginTime(logout, login);

    if (timeIsValid === false) {
      reasons.push("Login должен быть позже Logout");
    } else if (timeIsValid === null) {
      reasons.push("Не удалось сравнить время");
    }
  }

  return reasons.length
    ? {
        state: "mismatch",
        reason: reasons.join(" · "),
      }
    : {
        state: "match",
        reason: "Совпадает",
      };
};
