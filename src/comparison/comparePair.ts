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
  const sameType = left.type === right.type;
  const sameOdometer =
    left.odometer != null &&
    right.odometer != null &&
    left.odometer === right.odometer;

  if (sameType && sameOdometer) {
    reasons.push(
      left.type === "logout"
        ? "Два Logout — нет Login"
        : "Два Login — нет Logout",
    );
  } else if (!isComplementary(left, right)) {
    reasons.push("Login/Logout pair не сходится");
  }

  if (left.odometer !== right.odometer) {
    reasons.push("Odometer отличается");
  }

  /*
   * Location считается ошибкой только если
   * текст отличается на 40% или больше.
   */

  const locationCannotBeChecked =
    left.locationUnavailableReason != null ||
    right.locationUnavailableReason != null;
  if (
    isComplementary(left, right) &&
    !locationCannotBeChecked &&
    !locationsMatch(left.location, right.location)
  ) {
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

  if (reasons.length) {
    const hasChangeTruckException =
      left.hasChangeTruck === true ||
      right.hasChangeTruck === true ||
      left.nextLoginHasChangeTruck === true ||
      right.nextLoginHasChangeTruck === true;

    if (hasChangeTruckException) {
      return {
        state: "allowed",
        reason: "Допустимо — Change truck",
      };
    }

    return {
      state: "mismatch",
      reason: reasons.join(" · "),
    };
  }

  if (locationCannotBeChecked) {
    const hasRangeStart =
      left.locationUnavailableReason === "range-start" ||
      right.locationUnavailableReason === "range-start";

    const hasRangeEnd =
      left.locationUnavailableReason === "range-end" ||
      right.locationUnavailableReason === "range-end";

    if (hasRangeStart) {
      return {
        state: "match",
        reason: "Совпадает · Локация находится вне диапазона заданного периода",
      };
    }

    if (hasRangeEnd) {
      return {
        state: "match",
        reason:
          "Совпадает · Location не проверена: Login является последним событием диапазона",
      };
    }
  }

  return {
    state: "match",
    reason: "Совпадает",
  };
};
