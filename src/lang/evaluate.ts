/**
 * A document, evaluated one line at a time.
 *
 * **Every line is independent.** A line that fails shows a short reason in its own margin
 * and does not stop the lines below it, because errors are values rather than exceptions and
 * they propagate by being returned. A name bound to a failure poisons only the lines that
 * mention it, and those say which line let them down rather than repeating a reason that is
 * not about them.
 *
 * Evaluation is one downward pass and there are no forward references, because a notepad is
 * read downward. `x = y + 1` above `y = 2` is an error naming `y`, not a two-pass resolution
 * that would let a document depend on itself.
 */

import { dividedBy, into, minus, negate, plus, power, times, dateOrError } from "../value/arith";
import type { Display, Value } from "../value/value";
import { cal, err, isErr, money, num, of, none, pct } from "../value/value";
import { unitFor, refusalFor } from "../value/units";
import { add as addDim, sub as subDim, type Dimension } from "../value/dimension";
import type { Unit } from "../value/units";
import { parse, type Line, type Node, type UnitRef } from "./parse";

export interface Row {
  /** One-based, because it is shown to a person. */
  readonly line: number;
  readonly text: string;
  readonly value: Value;
  /** The name this line bound, if it bound one. */
  readonly name?: string;
}

/** The words that mean a calendar amount rather than a unit. */
const CALENDAR: ReadonlyMap<string, number> = new Map([
  ["month", 1], ["months", 1], ["mo", 1],
  ["year", 12], ["years", 12], ["yr", 12], ["yrs", 12],
]);

/**
 * What a name means, and the order is the whole rule.
 *
 * A variable wins over a unit. Somebody who wrote `m = 5` meant it, and the alternative is a
 * notepad where naming a variable `t` or `in` silently does nothing. The cost is that a
 * variable named after a unit shadows it for the rest of the document, which is what
 * shadowing means everywhere else and is visible in the line that caused it.
 */
function resolve(name: string, scope: ReadonlyMap<string, Value>): Value {
  const bound = scope.get(name);
  if (bound !== undefined) return bound;

  const months = CALENDAR.get(name.toLowerCase());
  if (months !== undefined) return cal(months);

  const unit = unitFor(name);
  // A bare unit word is one of that unit, which is what makes `100 km/h` need no special
  // case: `h` with nothing in front of it is one hour.
  if (unit) return of(1, unit);

  const refused = refusalFor(name);
  if (refused !== undefined) return err(refused);

  return err(`${name} is not defined`);
}

/** The units named on the right of `in`, as a display. Nothing else is allowed there. */
function displayOf(node: Node, scope: ReadonlyMap<string, Value>): Display | string {
  const over: Unit[] = [];
  const under: Unit[] = [];

  const walk = (n: Node, inverted: boolean): string | undefined => {
    if (n.t === "name") {
      // A name that is bound to something is not a unit here, and saying so is better than
      // silently converting into whatever it holds.
      if (scope.has(n.name)) return `${n.name} is a value, not a unit`;
      const unit = unitFor(n.name);
      if (!unit) return refusalFor(n.name) ?? `${n.name} is not a unit`;
      (inverted ? under : over).push(unit);
      return undefined;
    }
    if (n.t === "bin" && (n.op === "*" || n.op === "/")) {
      return walk(n.left, inverted) ?? walk(n.right, n.op === "/" ? !inverted : inverted);
    }
    if (n.t === "bin" && n.op === "^" && n.right.t === "num" && Number.isInteger(n.right.value)) {
      const times = Math.abs(n.right.value);
      for (let i = 0; i < times; i++) {
        const bad = walk(n.left, n.right.value < 0 ? !inverted : inverted);
        if (bad) return bad;
      }
      return undefined;
    }
    // `1` on top, as in `1/s`, is the one number allowed and it contributes nothing.
    if (n.t === "num" && n.value === 1) return undefined;
    return "only units can go after 'in'";
  };

  const bad = walk(node, false);
  return bad ?? { over, under };
}

function evaluateNode(n: Node, scope: ReadonlyMap<string, Value>, totalOf: () => Value): Value {
  switch (n.t) {
    case "num":
      return num(n.value);
    case "qty":
      return quantity(n.value, n.units, scope);
    case "pct":
      return pct(n.value);
    case "date":
      return dateOrError(n.year, n.month, n.day);
    case "name":
      return resolve(n.name, scope);
    case "total":
      return totalOf();
    case "bad":
      return err(n.message);
    case "neg":
      return negate(evaluateNode(n.of, scope, totalOf));
    case "money": {
      const inner = evaluateNode(n.of, scope, totalOf);
      if (isErr(inner)) return inner;
      if (inner.kind !== "qty" || inner.tag !== undefined) return err(`${n.tag} has to go in front of a number`);
      return { ...inner, tag: n.tag };
    }
    case "convert": {
      const of_ = evaluateNode(n.of, scope, totalOf);
      const display = displayOf(n.to, scope);
      if (typeof display === "string") return err(display);
      return into(of_, display, n.wanted);
    }
    case "bin": {
      const left = evaluateNode(n.left, scope, totalOf);
      const right = evaluateNode(n.right, scope, totalOf);
      switch (n.op) {
        case "+": return plus(left, right);
        case "-": return minus(left, right);
        case "*": return times(left, right);
        case "/": return dividedBy(left, right);
        case "^": return power(left, right);
      }
    }
  }
}

/**
 * A number with units after it.
 *
 * The parser grouped these tightly so `90 km/h` is one operand. Here they get their
 * meaning, and there are two outcomes.
 *
 * If any of the words is a name the document has bound, the grouping is dropped and this
 * becomes the multiplication and division chain it would have been without it. That is what
 * keeps `m = 5` shadowing metres: the parser cannot see the document's names, so the
 * decision has to be made here, and making it by rebuilding the chain means there is one
 * behaviour rather than two.
 *
 * Otherwise every word has to be a unit, and one that is not is named. `3 apples` never
 * reaches this, because the parser only groups words that are already in the table.
 */
function quantity(value: number, units: readonly UnitRef[], scope: ReadonlyMap<string, Value>): Value {
  if (units.some((u) => scope.has(u.name))) {
    let out: Value = num(value);
    for (const ref of units) {
      const held = resolve(ref.name, scope);
      const raised = ref.power === 1 ? held : power(held, num(Math.abs(ref.power)));
      out = ref.power < 0 ? dividedBy(out, raised) : times(out, raised);
    }
    return out;
  }

  const over: Unit[] = [];
  const under: Unit[] = [];
  let magnitude = value;
  for (const ref of units) {
    const unit = unitFor(ref.name);
    if (!unit) return err(refusalFor(ref.name) ?? `${ref.name} is not a unit`);
    const times_ = Math.abs(ref.power);
    for (let i = 0; i < times_; i++) {
      if (ref.power < 0) {
        magnitude /= unit.factor;
        under.push(unit);
      } else {
        magnitude *= unit.factor;
        over.push(unit);
      }
    }
  }

  let dimension = [0, 0, 0, 0, 0] as const as Dimension;
  for (const u of over) dimension = addDim(dimension, u.dimension);
  for (const u of under) dimension = subDim(dimension, u.dimension);

  return { kind: "qty", magnitude, dimension, display: { over, under } };
}

/**
 * The run of lines a `total` adds up.
 *
 * The contiguous lines directly above it that produced a value, stopping at a blank line or
 * at another total. An aggregate with an invisible window is a number nobody can check, so
 * the span is returned as well as the sum and the surface shows it.
 */
function windowFor(rows: readonly Row[], upto: number): Row[] {
  const out: Row[] = [];
  for (let i = upto - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.value.kind === "none") break;
    // A previous total ends the run, or every total after the first would include the ones
    // before it and double-count everything.
    if (/^\s*(total|sum|subtotal)\b/i.test(row.text)) break;
    out.unshift(row);
  }
  return out;
}

export interface Sheet {
  readonly rows: readonly Row[];
  /** For each line that is a total, the lines it added up. One-based, inclusive. */
  readonly windows: ReadonlyMap<number, readonly number[]>;
}

/** A whole document. Never throws, for any input. */
export function run(text: string): Sheet {
  const lines = text.split("\n");
  const rows: Row[] = [];
  const scope = new Map<string, Value>();
  /** Which line last bound each name, so a poisoned value can say where it came from. */
  const boundAt = new Map<string, number>();
  const windows = new Map<number, readonly number[]>();

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const parsed: Line = parse(text);
    const lineNumber = i + 1;

    const totalOf = (): Value => {
      const span = windowFor(rows, rows.length);
      windows.set(lineNumber, span.map((r) => r.line));
      if (span.length === 0) return err("nothing above this to add up");
      let sum: Value | undefined;
      for (const row of span) {
        // A failed line in the window is skipped rather than poisoning the total, because a
        // total is a convenience over what is visible and the broken line already says so
        // in its own margin.
        if (isErr(row.value)) continue;
        sum = sum === undefined ? row.value : plus(sum, row.value);
      }
      return sum ?? err("nothing above this to add up");
    };

    if (parsed.t === "blank" || parsed.t === "prose") {
      rows.push({ line: lineNumber, text, value: none });
      continue;
    }

    let value = evaluateNode(parsed.node, scope, totalOf);

    // A name that holds a failure says which line failed, rather than repeating a reason
    // that is not about this line.
    if (isErr(value) && value.blame === undefined) {
      const blamed = blameFor(parsed.node, scope, boundAt);
      if (blamed !== undefined) value = err(`depends on line ${blamed}, which failed`, blamed);
    }

    if (parsed.t === "assignment") {
      scope.set(parsed.name, value);
      boundAt.set(parsed.name, lineNumber);
      rows.push({ line: lineNumber, text, value, name: parsed.name });
    } else {
      rows.push({ line: lineNumber, text, value });
    }
  }

  return { rows, windows };
}

/** The earliest line this expression depends on that is itself a failure. */
function blameFor(n: Node, scope: ReadonlyMap<string, Value>, boundAt: ReadonlyMap<string, number>): number | undefined {
  let found: number | undefined;
  const walk = (node: Node): void => {
    switch (node.t) {
      case "name": {
        const held = scope.get(node.name);
        const line = boundAt.get(node.name);
        if (held !== undefined && isErr(held) && line !== undefined) {
          found = found === undefined ? line : Math.min(found, line);
        }
        return;
      }
      case "bin": walk(node.left); walk(node.right); return;
      case "neg": walk(node.of); return;
      case "money": walk(node.of); return;
      case "convert": walk(node.of); return;
      default: return;
    }
  };
  walk(n);
  return found;
}
