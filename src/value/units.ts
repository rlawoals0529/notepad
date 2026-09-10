/**
 * Every unit this notepad knows, as a factor into its dimension's base.
 *
 * A quantity carries its magnitude *already in base units* plus the unit to display it in,
 * so `3 m + 40 cm` adds 3 and 0.4 and renders `3.4 m` with no conversion in the hot path.
 * Conversion happens exactly twice: when a literal is read, and when an answer is rendered.
 *
 * **The factors are exact where the definition is exact**, and each one that is a definition
 * rather than a measurement says so. This matters more than it looks: a wrong constant is
 * perfectly self-consistent, so `x in lb in kg in lb` round-trips whatever the factor is.
 * A round-trip cannot validate a constant. Only a number checked against the standard that
 * defines it can, which is why the citations are here and why `units.test.ts` pins them.
 *
 * Hand-rolled rather than taken from a library, and the sizes are the argument: `mathjs` is
 * well over 100 KB and brings a whole expression engine that would duplicate the parser,
 * and `js-quantities` is smaller but still far more than the forty-odd units here.
 */

import type { Dimension } from "./dimension";
import { ANGLE, DATA, LENGTH, MASS, SCALAR, TIME } from "./dimension";


export interface Unit {
  /** What you type. */
  readonly name: string;
  readonly dimension: Dimension;
  /** How many base units one of these is. */
  readonly factor: number;
  /** Other spellings, including the plural. */
  readonly aliases: readonly string[];
}

/**
 * The table.
 *
 * Base units are the ones with a factor of 1: metre, kilogram, second, byte, radian.
 * Kilogram is the odd one, because the SI base unit for mass has a prefix already; the gram
 * is therefore 0.001 rather than the kilogram being 1000.
 */
const TABLE: readonly Unit[] = [
  // --- length. The inch is exactly 0.0254 m by international agreement (1959), and every
  // imperial length here is derived from it rather than measured separately, so they cannot
  // drift apart.
  { name: "m", dimension: LENGTH, factor: 1, aliases: ["metre", "metres", "meter", "meters"] },
  { name: "km", dimension: LENGTH, factor: 1000, aliases: ["kilometre", "kilometres", "kilometer", "kilometers"] },
  { name: "cm", dimension: LENGTH, factor: 0.01, aliases: ["centimetre", "centimetres", "centimeter", "centimeters"] },
  { name: "mm", dimension: LENGTH, factor: 0.001, aliases: ["millimetre", "millimetres", "millimeter", "millimeters"] },
  { name: "in", dimension: LENGTH, factor: 0.0254, aliases: ["inch", "inches"] },
  { name: "ft", dimension: LENGTH, factor: 0.3048, aliases: ["foot", "feet"] },
  { name: "yd", dimension: LENGTH, factor: 0.9144, aliases: ["yard", "yards"] },
  { name: "mi", dimension: LENGTH, factor: 1609.344, aliases: ["mile", "miles"] },

  // --- mass. The pound is exactly 0.45359237 kg, also 1959. The ounce is a sixteenth of it
  // and the stone is fourteen of them, again derived rather than rounded.
  { name: "kg", dimension: MASS, factor: 1, aliases: ["kilogram", "kilograms", "kilo", "kilos"] },
  { name: "g", dimension: MASS, factor: 0.001, aliases: ["gram", "grams"] },
  { name: "mg", dimension: MASS, factor: 0.000001, aliases: ["milligram", "milligrams"] },
  { name: "t", dimension: MASS, factor: 1000, aliases: ["tonne", "tonnes"] },
  { name: "lb", dimension: MASS, factor: 0.45359237, aliases: ["lbs", "pound", "pounds"] },
  { name: "oz", dimension: MASS, factor: 0.45359237 / 16, aliases: ["ounce", "ounces"] },
  { name: "st", dimension: MASS, factor: 0.45359237 * 14, aliases: ["stone", "stones"] },

  // --- time. Days and weeks are here because they are a fixed number of seconds. Months
  // and years are not, and that is the point: see dimension.ts.
  { name: "s", dimension: TIME, factor: 1, aliases: ["sec", "secs", "second", "seconds"] },
  { name: "ms", dimension: TIME, factor: 0.001, aliases: ["millisecond", "milliseconds"] },
  { name: "min", dimension: TIME, factor: 60, aliases: ["mins", "minute", "minutes"] },
  { name: "h", dimension: TIME, factor: 3600, aliases: ["hr", "hrs", "hour", "hours"] },
  { name: "day", dimension: TIME, factor: 86400, aliases: ["days"] },
  { name: "week", dimension: TIME, factor: 604800, aliases: ["weeks", "wk", "wks"] },

  // --- data. Two families, and they are kept apart on purpose: kB is 1000 bytes and KiB is
  // 1024, which is what the IEC prefixes exist to settle. Guessing which one somebody meant
  // is how a tool reports a disk as the wrong size and sounds certain about it.
  { name: "B", dimension: DATA, factor: 1, aliases: ["byte", "bytes"] },
  { name: "kB", dimension: DATA, factor: 1000, aliases: ["kilobyte", "kilobytes"] },
  { name: "MB", dimension: DATA, factor: 1e6, aliases: ["megabyte", "megabytes"] },
  { name: "GB", dimension: DATA, factor: 1e9, aliases: ["gigabyte", "gigabytes"] },
  { name: "TB", dimension: DATA, factor: 1e12, aliases: ["terabyte", "terabytes"] },
  { name: "KiB", dimension: DATA, factor: 1024, aliases: ["kibibyte", "kibibytes"] },
  { name: "MiB", dimension: DATA, factor: 1024 ** 2, aliases: ["mebibyte", "mebibytes"] },
  { name: "GiB", dimension: DATA, factor: 1024 ** 3, aliases: ["gibibyte", "gibibytes"] },
  { name: "TiB", dimension: DATA, factor: 1024 ** 4, aliases: ["tebibyte", "tebibytes"] },

  // --- angle. Linear, which is why it is here and temperature is not.
  { name: "rad", dimension: ANGLE, factor: 1, aliases: ["radian", "radians"] },
  { name: "deg", dimension: ANGLE, factor: Math.PI / 180, aliases: ["degree", "degrees", "°"] },
];

/**
 * Every spelling, to its unit.
 *
 * A Map rather than an object, and built once. An object here would be indexed by a string
 * that came from what somebody typed, which reaches the prototype for perfectly ordinary
 * words: `constructor` and `toString` are things a person writes in a notepad.
 */
const BY_NAME: ReadonlyMap<string, Unit> = (() => {
  const out = new Map<string, Unit>();
  for (const unit of TABLE) {
    for (const spelling of [unit.name, ...unit.aliases]) {
      const key = spelling.toLowerCase();
      // A collision here is two units answering to one word, and whichever lost would be
      // unreachable with nothing to say why. Loud at module load rather than silent.
      const taken = out.get(key);
      if (taken && taken !== unit) {
        throw new Error(`"${spelling}" is claimed by both ${taken.name} and ${unit.name}`);
      }
      out.set(key, unit);
    }
  }
  return out;
})();

/**
 * Spellings that are refused rather than guessed at.
 *
 * There are no bit units in the table, and lookup is case-insensitive, so `Mb` would
 * otherwise resolve to megabytes: an answer eight times too large, delivered with no
 * indication that anything was assumed. A bit is a real thing people write when they mean a
 * network speed, and the two spellings differ only by a case that no other unit here cares
 * about, so this cannot be left to a case-sensitive lookup.
 *
 * Refusing is the right answer rather than adding bits, because bits earn a family of their
 * own -- Mbps, the factor of eight, the fact that a "100 Mb line" moves 12.5 MB a second --
 * and half of that is worse than none of it.
 */
const REFUSED: ReadonlyMap<string, string> = new Map(
  ["bit", "kilobit", "megabit", "gigabit", "terabit", "kibibit", "mebibit", "gibibit", "tebibit"].flatMap((word) => [
    [word, "bits are not supported, only bytes. Write it in bytes, or say what you mean per second."],
    [`${word}s`, "bits are not supported, only bytes. Write it in bytes, or say what you mean per second."],
  ]),
);

/** Why a spelling is refused, if it is. */
export function refusalFor(spelling: string): string | undefined {
  const lower = spelling.toLowerCase();
  if (REFUSED.has(lower)) return REFUSED.get(lower);
  // Mb, Gb, kb and friends: a capital B is bytes and a lowercase b is bits, and that is the
  // one place in this table where case carries meaning. Only refuse the ambiguous form,
  // never a whole word: "b" alone is far more likely to be a variable than a bit.
  if (/^[kMGT]b$/.test(spelling)) {
    return `"${spelling}" is ambiguous: a lowercase b is bits and this notepad only knows bytes. Write "${spelling.slice(0, 1)}B" if you meant bytes.`;
  }
  return undefined;
}

/** The unit that spelling names, or undefined. */
export function unitFor(spelling: string): Unit | undefined {
  if (refusalFor(spelling) !== undefined) return undefined;
  return BY_NAME.get(spelling.toLowerCase());
}

/** Whether a word is a unit at all, which is the question the evaluator asks. */
export function isUnit(spelling: string): boolean {
  return unitFor(spelling) !== undefined;
}

/** Every unit, for a test that wants to walk the table. */
export function allUnits(): readonly Unit[] {
  return TABLE;
}

/** The dimensionless pseudo-unit a bare number carries, so every quantity has one. */
export const NONE: Unit = { name: "", dimension: SCALAR, factor: 1, aliases: [] };
