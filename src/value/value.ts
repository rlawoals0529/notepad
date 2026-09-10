/**
 * What a line evaluates to.
 *
 * Seven kinds, and the count is the result of deleting two rather than of adding five. A
 * plain number is a quantity with the zero dimension and a duration is a quantity with the
 * time dimension, so `number` and `duration` are not kinds here: `3 weeks from 2026-09-10`
 * falls out of `date + quantity<time>` instead of needing a rule of its own.
 *
 *   qty     a magnitude, a dimension, and how to show it. Numbers and durations included
 *   pct     a percentage, which is not a number: `+ 10%` and `+ 0.1` do different things
 *   date    a civil date. No instant, no zone, and that is the highest-leverage decision here
 *   zoned   a wall time in a named zone, resolved to an instant
 *   cal     months and years, which are not durations and cannot be one
 *   error   a value, not an exception, so propagation is automatic and nothing throws
 *   none    a line that produced nothing: prose, or blank
 *
 * **`error` being a value is the entire error-handling design.** A line that fails shows a
 * reason and does not stop the lines below it, and a name bound to an error poisons only the
 * lines that mention it. Nothing anywhere falls back to zero, because a silently wrong
 * number is the worst thing this program could produce.
 */

import type { Dimension } from "./dimension";
import { SCALAR, isScalar, same } from "./dimension";
import type { Unit } from "./units";

/**
 * How to render a quantity, as the units it was written with.
 *
 * Two lists rather than one unit, because `km/h` is a unit the table does not contain and
 * enumerating every compound somebody might write is not a table, it is a guess. The
 * magnitude is already in base units, so this is only ever consulted when rendering.
 *
 * An empty `over` and `under` is a plain number, which is why a number needs no separate
 * kind.
 */
export interface Display {
  readonly over: readonly Unit[];
  readonly under: readonly Unit[];
}

export const PLAIN: Display = { over: [], under: [] };

/**
 * A currency, as a tag on a dimensionless quantity.
 *
 * Never a dimension, and the difference is the point: `$1850 + $150` is `$2000` with no rate
 * involved, which is the operation people actually want. `$5 + €5` is an error rather than a
 * number, and there is no conversion at all, because any rate would have to be bundled and a
 * bundled rate is wrong by the time you read it. That is the same argument as the timezone
 * database, reaching the opposite conclusion, and for a good reason: the browser ships a tz
 * database that its vendor patches, and it ships no exchange rates.
 */
export type Tag = string;

export interface Qty {
  readonly kind: "qty";
  /** Already in base units. Adding never converts. */
  readonly magnitude: number;
  readonly dimension: Dimension;
  readonly display: Display;
  /** A currency, on dimensionless quantities only. */
  readonly tag?: Tag;
}

export interface Pct {
  readonly kind: "pct";
  /** 20% is 20 here, not 0.2, so the rendering is the number that was typed. */
  readonly percent: number;
}

/**
 * A civil date: a year, a month and a day, with no instant and no zone.
 *
 * This is the highest-leverage decision in the whole design, because it removes the entire
 * daylight-saving class of bug from date arithmetic. `3 weeks from` a date is integer
 * arithmetic on a day count, not milliseconds added to an instant, so it cannot land an hour
 * out twice a year and it cannot be affected by where the person running it is sitting.
 */
export interface CivilDate {
  readonly kind: "date";
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  /** 1 to 31. */
  readonly day: number;
}

/** A wall time in a named zone, already resolved to an instant. */
export interface Zoned {
  readonly kind: "zoned";
  readonly epochMs: number;
  /** The user's own spelling, never the canonicalised id: ICU versions disagree on direction. */
  readonly zone: string;
}

/**
 * Months and years, which are calendar amounts rather than durations.
 *
 * Kept out of the unit table on purpose. A month is not a fixed number of seconds, and
 * putting one there would encode that it is thirty days, which is the same species of lie as
 * a bundled exchange rate. These are usable only in civil date arithmetic, where "add one
 * month" has a meaning, and that meaning includes clamping the end of the month.
 */
export interface Cal {
  readonly kind: "cal";
  readonly months: number;
}

/**
 * A failure, as a value.
 *
 * `blame` names the line a failure came from, so a line that merely mentions a broken name
 * reads "depends on line 4, which failed" rather than repeating a reason that is not about
 * it. Line numbers are one-based, because they are shown to a person.
 */
export interface Err {
  readonly kind: "error";
  readonly message: string;
  readonly blame?: number;
}

/** A line that produced nothing. Prose and blank lines, and not an error. */
export interface None {
  readonly kind: "none";
}

export type Value = Qty | Pct | CivilDate | Zoned | Cal | Err | None;

// --- making them ---------------------------------------------------------------------------

export const none: None = { kind: "none" };

export function err(message: string, blame?: number): Err {
  return blame === undefined ? { kind: "error", message } : { kind: "error", message, blame };
}

/** A plain number. */
export function num(magnitude: number): Qty {
  return { kind: "qty", magnitude, dimension: SCALAR, display: PLAIN };
}

/** An amount of money, which is a plain number wearing a tag. */
export function money(magnitude: number, tag: Tag): Qty {
  return { kind: "qty", magnitude, dimension: SCALAR, display: PLAIN, tag };
}

/** A quantity written with one unit, converted into base units on the way in. */
export function of(amount: number, unit: Unit): Qty {
  return {
    kind: "qty",
    magnitude: amount * unit.factor,
    dimension: unit.dimension,
    display: { over: [unit], under: [] },
  };
}

export function pct(percent: number): Pct {
  return { kind: "pct", percent };
}

export function date(year: number, month: number, day: number): CivilDate {
  return { kind: "date", year, month, day };
}

export function cal(months: number): Cal {
  return { kind: "cal", months };
}

// --- asking about them ---------------------------------------------------------------------

export const isErr = (v: Value): v is Err => v.kind === "error";
export const isQty = (v: Value): v is Qty => v.kind === "qty";

/** A quantity with no dimension and no unit: what `3` is, and what `3 m / 1 m` becomes. */
export function isPlainNumber(v: Value): v is Qty {
  return v.kind === "qty" && isScalar(v.dimension) && v.display.over.length === 0 && v.display.under.length === 0;
}

/** Whether two quantities can be added, which is tuple equality and nothing else. */
export function addable(a: Qty, b: Qty): boolean {
  return same(a.dimension, b.dimension) && a.tag === b.tag;
}

/**
 * How many base units one of the display's compound unit is.
 *
 * `km/h` is 1000 over 3600. Used only when rendering, since the magnitude is already based.
 */
export function displayFactor(d: Display): number {
  let factor = 1;
  for (const u of d.over) factor *= u.factor;
  for (const u of d.under) factor /= u.factor;
  return factor;
}

/** The display written out, which is what a reader sees after the number. */
export function displayName(d: Display): string {
  if (d.over.length === 0 && d.under.length === 0) return "";
  const part = (units: readonly Unit[]): string => {
    // Repeats become a power, so m*m renders as m² rather than as "m m".
    const counts = new Map<string, number>();
    for (const u of units) counts.set(u.name, (counts.get(u.name) ?? 0) + 1);
    return [...counts]
      .map(([name, n]) => (n === 1 ? name : `${name}${superscript(n)}`))
      .join("·");
  };
  const over = d.over.length === 0 ? "1" : part(d.over);
  return d.under.length === 0 ? over : `${over}/${part(d.under)}`;
}

function superscript(n: number): string {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(n)
    .split("")
    .map((c) => digits[Number(c)] ?? c)
    .join("");
}
