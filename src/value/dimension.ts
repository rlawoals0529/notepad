/**
 * What a quantity is *of*, as five integers.
 *
 * Every unit this notepad knows is a factor times some combination of five base
 * dimensions, so a dimension is the exponent of each: `[1, 0, 0, 0, 0]` is a length,
 * `[1, 0, -1, 0, 0]` is a length over a time, which is a speed. A plain number is
 * `[0, 0, 0, 0, 0]`, which is what lets a number and a duration be the same kind of value
 * with two branches deleted rather than two more cases in a union.
 *
 * **Compatibility is tuple equality**, and that is the whole reason for representing it
 * this way. `3 m + 2 kg` is an error by construction rather than by a check somebody has to
 * remember to write, and `km/h + mph` works without either of them being enumerated as a
 * pair, because they arrive here as the same five numbers.
 *
 * The five, and why these five:
 *
 *   length    metres and everything that converts to one
 *   mass      kilograms, and note this is mass, not weight
 *   time      seconds. Months and years are deliberately NOT here, see below
 *   data      bytes, which never mix with anything else but do convert among themselves
 *   angle     radians. Linear, unlike the one that is missing
 *
 * **Temperature is not here on purpose.** Celsius to Fahrenheit is affine, not a factor, so
 * it cannot be a row in a unit table without making every other row a special case. It was
 * cut rather than half-supported.
 *
 * **Months and years are not time.** A month is not a fixed number of seconds, and putting
 * one in this table would encode that it is: `1 month` would become thirty days and every
 * answer that used it would be quietly wrong. They are calendar values, usable only in
 * civil date arithmetic, and they live elsewhere.
 */

/** Length, mass, time, data, angle. Always five, always integers. */
export type Dimension = readonly [number, number, number, number, number];

/** The dimensionless one, which is what a plain number is. */
export const SCALAR: Dimension = [0, 0, 0, 0, 0];

export const LENGTH: Dimension = [1, 0, 0, 0, 0];
export const MASS: Dimension = [0, 1, 0, 0, 0];
export const TIME: Dimension = [0, 0, 1, 0, 0];
export const DATA: Dimension = [0, 0, 0, 1, 0];
export const ANGLE: Dimension = [0, 0, 0, 0, 1];

/** The names, in tuple order, for the message a mismatch produces. */
const NAMES = ["length", "mass", "time", "data", "angle"] as const;

export function same(a: Dimension, b: Dimension): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
}

export function isScalar(d: Dimension): boolean {
  return same(d, SCALAR);
}

/** Multiplying quantities adds their dimensions. */
export function add(a: Dimension, b: Dimension): Dimension {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4]];
}

/** Dividing subtracts them, which is where `km/h` comes from. */
export function sub(a: Dimension, b: Dimension): Dimension {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3], a[4] - b[4]];
}

/** Raising to an integer power multiplies them, which is where `m^2` comes from. */
export function scale(d: Dimension, n: number): Dimension {
  return [d[0] * n, d[1] * n, d[2] * n, d[3] * n, d[4] * n];
}

/**
 * A dimension in words, for an error a person has to read.
 *
 * "length/time" rather than "[1,0,-1,0,0]", because the message this ends up in is the only
 * explanation somebody gets for why their line has no number, and a tuple explains nothing.
 * Superscripts rather than `^2`, since the answer column is prose and this is the only
 * place it appears.
 */
export function describe(d: Dimension): string {
  if (isScalar(d)) return "a plain number";

  // Takes the magnitude, because the sign is already carried by which side of the slash
  // this ends up on. Passing -1 in and getting a bare superscript one back was the bug:
  // "length/time¹" for a plain speed.
  const sup = (n: number): string => {
    const magnitude = Math.abs(n);
    if (magnitude === 1) return "";
    const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
    return String(magnitude)
      .split("")
      .map((c) => digits[Number(c)] ?? c)
      .join("");
  };

  const over: string[] = [];
  const under: string[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const n = d[i] ?? 0;
    const name = NAMES[i] ?? "?";
    if (n > 0) over.push(name + sup(n));
    else if (n < 0) under.push(name + sup(n));
  }

  // A dimension that is only negative powers reads better as "per x" than as "1/x", which
  // is how a rate with no numerator is usually said out loud.
  if (over.length === 0) return `per ${under.join(" ")}`;
  if (under.length === 0) return over.join(" ");
  return `${over.join(" ")}/${under.join(" ")}`;
}
