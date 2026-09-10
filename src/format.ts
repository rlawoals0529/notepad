/**
 * A value as the text in the margin.
 *
 * Two rules carry all of it. **Never print a figure that was not computed**, so an error
 * renders as words and never as a number, and there is no path from a failure to a zero.
 * And **round for reading, not for storage**: the magnitude keeps full precision, and only
 * the string is shortened, so `0.1 + 0.2` shows `0.3` while still adding correctly into the
 * next line.
 */

import { displayName, type Value } from "./value/value";
import { displayFactor } from "./value/value";
import { weekday } from "./time/civil";

/**
 * Short forms, because the margin is narrow and an elided answer is not an answer.
 *
 * "Saturday 12 September 2026" did not fit and rendered as "Saturday 12 September…", which
 * is worse than useless: it looks like the tool ran out of room mid-thought. Three letters
 * carry the same information in a third of the width.
 */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * How many digits to keep.
 *
 * Ten significant figures. Well inside the fifteen or so a double is good for, so a value
 * that came out of a chain of conversions does not display its own floating-point noise:
 * `0.1 + 0.2` is 0.30000000000000004 in memory and `0.3` on screen. That is the right way
 * round, because rounding the stored number instead would make every later line wrong by a
 * little.
 *
 * Ten rather than twelve because a margin is read at a glance and `2.66666666667` is not
 * read, it is skipped. Ten still separates a third from two thirds at any scale anybody puts
 * in a notepad.
 */
const DIGITS = 10;

/**
 * An amount of money, which shows either no decimals or exactly two.
 *
 * Never one. `$9.8` is not a price anybody has written down, and reading it takes a beat
 * that a notepad should not cost. A figure that genuinely needs more than two decimals keeps
 * them, because rounding somebody's rate to a penny would be inventing a number.
 */
function asMoney(text: string): string {
  const [whole = "0", fraction] = text.split(".");
  if (fraction === undefined) return whole;
  if (fraction.length === 1) return `${whole}.${fraction}0`;
  return text;
}

function number(n: number): string {
  if (!Number.isFinite(n)) return "not a number";
  if (n === 0) return "0";

  const rounded = Number(n.toPrecision(DIGITS));

  // Very large and very small go to exponent form, because a margin cannot hold twenty
  // zeroes and a reader cannot count them.
  const magnitude = Math.abs(rounded);
  if (magnitude >= 1e15 || magnitude < 1e-9) return rounded.toExponential(6).replace(/e\+?/, "e");

  // Grouped thousands, because the figures people put in a notepad are the kind you read
  // aloud. Only on the integer part: grouping a decimal is not a convention anywhere.
  const [whole = "0", fraction] = String(rounded).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function format(v: Value): string {
  switch (v.kind) {
    case "none":
      return "";

    case "error":
      // Words, never a figure. This is the one branch that would have to be edited for this
      // program to be able to show a wrong number.
      return v.message;

    case "pct":
      return `${number(v.percent)}%`;

    case "qty": {
      const shown = v.magnitude / displayFactor(v.display);
      const unit = displayName(v.display);
      if (v.tag !== undefined) return `${v.tag}${asMoney(number(shown))}`;
      return `${number(shown)}${unit ? ` ${unit}` : ""}`;
    }

    case "cal":
      return v.months % 12 === 0
        ? `${number(v.months / 12)} ${Math.abs(v.months) === 12 ? "year" : "years"}`
        : `${number(v.months)} ${Math.abs(v.months) === 1 ? "month" : "months"}`;

    case "date": {
      const day = WEEKDAYS[weekday(v)] ?? "";
      const month = MONTHS[v.month - 1] ?? String(v.month);
      // The weekday is the part people actually want from a date they just worked out, and
      // it is free to compute.
      return `${day} ${v.day} ${month} ${v.year}`;
    }

    case "zoned": {
      const shown = new Intl.DateTimeFormat("en-GB", {
        timeZone: v.zone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v.epochMs));
      // The user's own spelling of the zone, never the canonicalised id: ICU versions
      // disagree about which direction an alias points.
      return `${shown} ${v.zone}`;
    }
  }
}
