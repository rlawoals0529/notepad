/**
 * Arithmetic on a date that has no instant and no zone.
 *
 * Everything here is integer arithmetic on a day count, and that is the whole reason civil
 * dates exist in this program: adding three weeks to a date cannot land an hour out twice a
 * year, cannot depend on where the person running it is sitting, and cannot be affected by
 * a timezone database being out of date. There is no `Date` in this file and no
 * milliseconds, so there is nothing for daylight saving to happen to.
 *
 * The day count is days since 1970-01-01, using the standard civil-from-days algorithm,
 * which is exact for every year in range and needs no table of leap years.
 */

export interface Civil {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Days from the civil date. Exact, and defined for years before 1970 as negatives. */
export function toDays(d: Civil): number {
  // Shift so the year starts in March, which puts the leap day at the end and removes every
  // special case from what follows.
  const y = d.year - (d.month <= 2 ? 1 : 0);
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (d.month + (d.month > 2 ? -3 : 9)) + 2) / 5) + d.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** And back. The exact inverse of toDays, which a property test pins. */
export function fromDays(days: number): Civil {
  const z = days + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** How many days that month has, which is the only place leap years are decided. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

export function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A date, or the reason it is not one. Checked so 2026-02-30 cannot become 2026-03-02. */
export function valid(d: Civil): string | undefined {
  if (!Number.isInteger(d.year) || !Number.isInteger(d.month) || !Number.isInteger(d.day)) {
    return "a date has to be whole numbers";
  }
  if (d.month < 1 || d.month > 12) return `there is no month ${d.month}`;
  const last = daysInMonth(d.year, d.month);
  if (d.day < 1 || d.day > last) {
    return `${d.year}-${String(d.month).padStart(2, "0")} has ${last} days, so there is no day ${d.day}`;
  }
  return undefined;
}

export function addDays(d: Civil, days: number): Civil {
  return fromDays(toDays(d) + Math.trunc(days));
}

/**
 * Add months, clamping to the end of the target month.
 *
 * 31 January plus one month is 28 February, or 29 in a leap year. There is no answer here
 * that is not a convention, and clamping is the one every calendar uses, so a person reading
 * the answer is not surprised by it. Rolling over into March would be defensible in
 * isolation and wrong against every expectation.
 *
 * This is also why months are not in the unit table: there is no number of seconds that
 * produces this behaviour.
 */
export function addMonths(d: Civil, months: number): Civil {
  const whole = Math.trunc(months);
  const zeroBased = d.month - 1 + whole;
  const year = d.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

/** Whole days between two dates, later minus earlier. */
export function between(from: Civil, to: Civil): number {
  return toDays(to) - toDays(from);
}

/** The weekday, for a date that is being shown. 0 is Sunday. */
export function weekday(d: Civil): number {
  // 1970-01-01 was a Thursday, which is 4.
  return (((toDays(d) + 4) % 7) + 7) % 7;
}
