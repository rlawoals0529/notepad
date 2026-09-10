/**
 * What you can do to two values, and what each refusal is protecting.
 *
 * Every operation here is total: it returns a `Value`, and an impossible one returns an
 * `error` value rather than throwing. That is what makes a line that fails leave the lines
 * below it alone, and it is why nothing in this file has a `try`.
 *
 * **There is no coercion path for `+`.** Not even the tempting one, where a dimensionless
 * operand is treated as a scalar so `3 m + 2` means five metres. It is refused, because the
 * person who typed it either meant `3 m + 2 m` or meant something this notepad cannot know,
 * and guessing produces a number that is confidently wrong. Multiplication is where a plain
 * number belongs.
 */

import { add as addDim, describe as describeDim, isScalar, same, sub as subDim, TIME } from "./dimension";
import { addDays, addMonths, between, valid } from "../time/civil";
import { unitFor } from "./units";
import type { Qty, Value } from "./value";
import { PLAIN, addable, cal, date, displayName, err, isErr, num, of, pct } from "./value";
import type { Cal, CivilDate } from "./value";
import type { Display } from "./value";
import type { Unit } from "./units";

/** The first error of the operands, so a failure propagates without anybody checking twice. */
function firstError(...values: Value[]): Value | undefined {
  return values.find(isErr);
}

/**
 * The display to give a result.
 *
 * The left operand's, when both agree on a dimension. `3 m + 40 cm` is `3.4 m` rather than
 * `340 cm`, because the first unit written is the one the reader is thinking in, and an
 * answer that silently changes units is an answer they have to re-read.
 */
function keepLeft(a: Qty, b: Qty): Display {
  if (a.display.over.length > 0 || a.display.under.length > 0) return a.display;
  return b.display;
}

/** Cancel a unit appearing on both sides, so `m/m` renders as nothing rather than as m/m. */
function cancel(over: readonly Unit[], under: readonly Unit[]): Display {
  const remainingUnder = [...under];
  const remainingOver: Unit[] = [];
  for (const u of over) {
    const at = remainingUnder.findIndex((v) => v.name === u.name);
    if (at >= 0) remainingUnder.splice(at, 1);
    else remainingOver.push(u);
  }
  return { over: remainingOver, under: remainingUnder };
}

// --- addition and subtraction ----------------------------------------------------------------

export function plus(a: Value, b: Value): Value {
  return addOrSubtract(a, b, 1);
}

export function minus(a: Value, b: Value): Value {
  return addOrSubtract(a, b, -1);
}

function addOrSubtract(a: Value, b: Value, sign: 1 | -1): Value {
  const broken = firstError(a, b);
  if (broken) return broken;

  // Dates first, because a date is not a quantity and every branch below assumes one.
  if (a.kind === "date" || b.kind === "date" || a.kind === "cal" || b.kind === "cal") {
    return dateArithmetic(a, b, sign);
  }

  // A percentage of the thing it is being added to, which is what `+ 10%` means everywhere
  // outside a programming language. `120 + 10%` is 132, not 130.
  if (a.kind === "qty" && b.kind === "pct") {
    return { ...a, magnitude: a.magnitude * (1 + (sign * b.percent) / 100) };
  }
  // The other way round has no reading that is not a guess: `10% + 120` could be 132 or a
  // type error, and only one of those is honest.
  if (a.kind === "pct" && b.kind === "qty") {
    return err("a percentage has to come after the thing it is a percentage of");
  }
  if (a.kind === "pct" && b.kind === "pct") {
    return pct(a.percent + sign * b.percent);
  }

  if (a.kind !== "qty" || b.kind !== "qty") {
    return err(`cannot ${sign === 1 ? "add" : "subtract"} ${nameOf(b)} ${sign === 1 ? "to" : "from"} ${nameOf(a)}`);
  }

  if (a.tag !== b.tag) {
    // Two currencies, and there is no rate here on purpose. Bundling one would ship our own
    // stale number with a timestamp on it, which is worse than saying we do not know.
    if (a.tag !== undefined && b.tag !== undefined) {
      return err(`${a.tag} and ${b.tag} cannot be added: this notepad has no exchange rates, and any it bundled would be out of date`);
    }
    return err(`${a.tag ?? "a plain number"} and ${b.tag ?? "a plain number"} do not add`);
  }

  if (!addable(a, b)) {
    return err(`${describeDim(a.dimension)} and ${describeDim(b.dimension)} do not add`);
  }

  return { ...a, magnitude: a.magnitude + sign * b.magnitude, display: keepLeft(a, b) };
}

/**
 * Everything involving a date or a calendar amount.
 *
 * The rules are short, and each one that is missing is missing on purpose:
 *
 *   date + duration    whole days only, because a civil date has no time of day to move
 *   date + months      clamped to the end of the month, per civil.ts
 *   date - date        a duration in days
 *   months + months    a calendar amount
 *
 * A date plus a date is not a thing, and neither is a date times anything. Both are refused
 * rather than given a reading, because there is no answer a person would recognise.
 */
function dateArithmetic(a: Value, b: Value, sign: 1 | -1): Value {
  // date - date is the interesting one: the answer is a duration, in days.
  if (a.kind === "date" && b.kind === "date") {
    if (sign === 1) return err("two dates cannot be added. Subtract them to get the time between");
    const days = between(b, a);
    return of(days, unitFor("day")!);
  }

  if (a.kind === "date" && b.kind === "cal") return shiftMonths(a, sign * b.months);
  if (a.kind === "cal" && b.kind === "date") {
    // `3 months + a date` reads fine to a person, so it is accepted rather than made an
    // error over word order. Subtracting a date from a duration is still nonsense.
    if (sign === -1) return err("a date cannot be subtracted from a number of months");
    return shiftMonths(b, a.months);
  }

  if (a.kind === "cal" && b.kind === "cal") return cal(a.months + sign * b.months);

  if (a.kind === "date" && b.kind === "qty") {
    if (!same(b.dimension, TIME)) {
      return err(`a date and ${describeDim(b.dimension)} do not add. A date takes a length of time`);
    }
    const days = b.magnitude / 86400;
    if (!Number.isInteger(days)) {
      // A date has no time of day, so half a day has nowhere to go. Saying so beats
      // truncating, which would make `+ 36 hours` and `+ 1 day` the same answer.
      return err("a date can only move by whole days, and this is not a whole number of them");
    }
    return shiftDays(a, sign * days);
  }

  if (a.kind === "qty" && b.kind === "date") {
    if (sign === -1) return err("a date cannot be subtracted from a length of time");
    if (!same(a.dimension, TIME)) return err(`${describeDim(a.dimension)} and a date do not add`);
    const days = a.magnitude / 86400;
    if (!Number.isInteger(days)) return err("a date can only move by whole days, and this is not a whole number of them");
    return shiftDays(b, days);
  }

  if (a.kind === "cal" && b.kind === "qty") {
    return err("months and a length of time do not add, because a month is not a fixed number of days");
  }
  if (a.kind === "qty" && b.kind === "cal") {
    return err("a length of time and months do not add, because a month is not a fixed number of days");
  }

  return err(`cannot ${sign === 1 ? "add" : "subtract"} ${nameOf(a)} and ${nameOf(b)}`);
}

function shiftDays(d: CivilDate, days: number): Value {
  const moved = addDays({ year: d.year, month: d.month, day: d.day }, days);
  return date(moved.year, moved.month, moved.day);
}

function shiftMonths(d: CivilDate, months: number): Value {
  const moved = addMonths({ year: d.year, month: d.month, day: d.day }, months);
  return date(moved.year, moved.month, moved.day);
}

/** A date, checked, or the reason it is not one. Used where a literal is built. */
export function dateOrError(year: number, month: number, day: number): Value {
  const why = valid({ year, month, day });
  return why === undefined ? date(year, month, day) : err(why);
}

/** Scaling a calendar amount, which is the only arithmetic it takes besides adding. */
export function scaleCal(c: Cal, by: number): Value {
  if (!Number.isInteger(c.months * by)) {
    return err("a number of months has to be whole, because half a month is not a length of time");
  }
  return cal(c.months * by);
}

// --- multiplication and division ---------------------------------------------------------------

export function times(a: Value, b: Value): Value {
  const broken = firstError(a, b);
  if (broken) return broken;

  // `20% * 50` and `50 * 20%` both mean a fifth of fifty. Unlike addition this is
  // symmetric, because "a percentage of" reads the same either way round.
  if (a.kind === "pct" && b.kind === "qty") return scaleBy(b, a.percent / 100);
  if (a.kind === "qty" && b.kind === "pct") return scaleBy(a, b.percent / 100);
  if (a.kind === "pct" && b.kind === "pct") return pct((a.percent * b.percent) / 100);

  // A plain number times a calendar amount is a calendar amount: `3 months` is exactly
  // this, since a bare unit word is one of that unit.
  if (a.kind === "qty" && b.kind === "cal" && isScalar(a.dimension) && a.tag === undefined) return scaleCal(b, a.magnitude);
  if (a.kind === "cal" && b.kind === "qty" && isScalar(b.dimension) && b.tag === undefined) return scaleCal(a, b.magnitude);

  if (a.kind !== "qty" || b.kind !== "qty") return err(`cannot multiply ${nameOf(a)} by ${nameOf(b)}`);

  const tag = combineTags(a, b);
  if (typeof tag === "object") return tag;

  return {
    kind: "qty",
    magnitude: a.magnitude * b.magnitude,
    dimension: addDim(a.dimension, b.dimension),
    display: cancel([...a.display.over, ...b.display.over], [...a.display.under, ...b.display.under]),
    ...(tag === undefined ? {} : { tag }),
  };
}

export function dividedBy(a: Value, b: Value): Value {
  const broken = firstError(a, b);
  if (broken) return broken;

  if (a.kind === "qty" && b.kind === "pct") {
    if (b.percent === 0) return err("cannot divide by zero");
    return scaleBy(a, 100 / b.percent);
  }
  if (a.kind !== "qty" || b.kind !== "qty") return err(`cannot divide ${nameOf(a)} by ${nameOf(b)}`);

  // Said rather than returned as Infinity, which would render as a number and read as one.
  if (b.magnitude === 0) return err("cannot divide by zero");

  const tag = combineTags(a, b);
  if (typeof tag === "object") return tag;

  return {
    kind: "qty",
    magnitude: a.magnitude / b.magnitude,
    dimension: subDim(a.dimension, b.dimension),
    display: cancel([...a.display.over, ...b.display.under], [...a.display.under, ...b.display.over]),
    ...(tag === undefined ? {} : { tag }),
  };
}

/**
 * The tag a product or quotient carries, or the error that says it cannot have one.
 *
 * At most one side may be tagged. `$20 * 3` is `$60`, and `$20 * $3` is nothing anybody
 * means: money times money is not a kind of money, and returning dollars-squared would be a
 * unit the reader has to decide is a bug.
 */
function combineTags(a: Qty, b: Qty): string | undefined | Value {
  if (a.tag !== undefined && b.tag !== undefined) {
    return err(`${a.tag} and ${b.tag} cannot be multiplied together: money times money is not an amount of money`);
  }
  return a.tag ?? b.tag;
}

function scaleBy(q: Qty, factor: number): Qty {
  return { ...q, magnitude: q.magnitude * factor };
}

// --- and the rest ------------------------------------------------------------------------------

/** Unary minus, which is the only prefix operator here. */
export function negate(a: Value): Value {
  if (isErr(a)) return a;
  if (a.kind === "qty") return { ...a, magnitude: -a.magnitude };
  if (a.kind === "pct") return pct(-a.percent);
  return err(`cannot negate ${nameOf(a)}`);
}

/**
 * A power, with an integer exponent only.
 *
 * `m^0.5` is a dimension of half a length, which the five-tuple cannot hold and which no
 * reader of a notepad is asking for. Refused rather than rounded.
 */
export function power(a: Value, b: Value): Value {
  const broken = firstError(a, b);
  if (broken) return broken;
  if (a.kind !== "qty" || b.kind !== "qty") return err(`cannot raise ${nameOf(a)} to ${nameOf(b)}`);
  if (!isScalar(b.dimension)) return err(`an exponent has to be a plain number, not ${describeDim(b.dimension)}`);
  if (!Number.isInteger(b.magnitude)) {
    if (isScalar(a.dimension)) return num(a.magnitude ** b.magnitude);
    return err(`${displayName(a.display) || describeDim(a.dimension)} cannot be raised to a fractional power`);
  }

  const n = b.magnitude;
  let out: Value = num(1);
  const base = n < 0 ? dividedBy(num(1), a) : a;
  for (let i = 0; i < Math.abs(n); i++) out = times(out, base);
  return out;
}

/** Converting for display: `3 m in cm`. The magnitude never changes, only how it is shown. */
export function into(a: Value, display: Display, wanted: string): Value {
  if (isErr(a)) return a;
  if (a.kind !== "qty") return err(`cannot convert ${nameOf(a)} into ${wanted}`);

  const target = dimensionOf(display);
  if (!sameTuple(a.dimension, target)) {
    return err(`${describeDim(a.dimension)} cannot be shown as ${describeDim(target)}`);
  }
  if (a.tag !== undefined) {
    // The dedicated refusal, because this is the one somebody will actually try.
    return err(`${a.tag} cannot be converted: this notepad has no exchange rates, and any it bundled would be out of date`);
  }
  return { ...a, display };
}

function dimensionOf(d: Display) {
  let out = addDim([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
  for (const u of d.over) out = addDim(out, u.dimension);
  for (const u of d.under) out = subDim(out, u.dimension);
  return out;
}

const sameTuple = (a: readonly number[], b: readonly number[]) => a.every((n, i) => n === b[i]);

/** What a value is, for a message. Never a JSON dump. */
function nameOf(v: Value): string {
  switch (v.kind) {
    case "qty":
      return v.tag !== undefined ? `an amount in ${v.tag}` : describeDim(v.dimension);
    case "pct":
      return "a percentage";
    case "date":
      return "a date";
    case "zoned":
      return "a time";
    case "cal":
      return v.months % 12 === 0 ? "a number of years" : "a number of months";
    case "error":
      return "something that failed";
    case "none":
      return "nothing";
  }
}

export { PLAIN };
