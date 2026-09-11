/**
 * A line, as a tree.
 *
 * Precedence climbing, hand written. No parser library, and the reason is the size of this
 * grammar: it is about a hundred and fifty lines, and a library would be a dependency, a
 * build step and a grammar file to keep in step with the evaluator.
 *
 * Total, like every stage: an input it cannot parse becomes a `bad` node carrying a reason,
 * never an exception. That is what lets one broken line sit between two working ones.
 *
 * **This still does not decide whether a word is a unit or a variable.** A word becomes a
 * `name` node either way, and the evaluator resolves it, so there is exactly one place that
 * knows the rule.
 *
 * Precedence, tightest first:
 *
 *   ^              right associative, so 2^3^2 is 2^9
 *   -x             unary minus, looser than ^ so that -2^2 is -4, as it is everywhere else
 *   number+unit    tighter than everything, so `90 km/h` is one operand. See below.
 *   * / and space  juxtaposition, which is what a number beside anything else means
 *   + -
 *   in / to        conversion, loosest, so `1 m + 20 cm in mm` converts the sum
 */

import type { Token } from "./tokenise";
import { tokenise } from "./tokenise";
import { unitFor } from "../value/units";

export type Node =
  | { readonly t: "num"; readonly value: number }
  /**
   * A number with units written after it: `3 m`, `90 km/h`, `2 m^2`.
   *
   * Grouped here rather than left as a chain of multiplications, because the chain gets
   * `240 km / 90 km/h` wrong and there is no precedence that does not. Left-associative
   * juxtaposition reads it as `((240 km / 90) * km) / h`, which is km²/h; that was in the
   * example document on the first screen, which is how it was found.
   *
   * **The words are kept as words, and the evaluator still decides what they mean.** If any
   * of them is a name the document has bound, this degrades to exactly the multiplication
   * chain it would otherwise have been, so `m = 5` still shadows metres. The parser uses
   * the unit table only to decide where the operand ends, which is a question about shape
   * rather than about meaning, and it cannot see the document's names anyway.
   */
  | { readonly t: "qty"; readonly value: number; readonly units: readonly UnitRef[] }
  | { readonly t: "money"; readonly tag: string; readonly of: Node }
  | { readonly t: "pct"; readonly value: number }
  | { readonly t: "date"; readonly year: number; readonly month: number; readonly day: number }
  | { readonly t: "name"; readonly name: string; readonly at: number }
  | { readonly t: "bin"; readonly op: "+" | "-" | "*" | "/" | "^"; readonly left: Node; readonly right: Node }
  | { readonly t: "neg"; readonly of: Node }
  | { readonly t: "convert"; readonly of: Node; readonly to: Node; readonly wanted: string }
  | { readonly t: "total" }
  | { readonly t: "bad"; readonly message: string; readonly at: number };

/** One unit written after a number. A negative power is a denominator. */
export interface UnitRef {
  readonly name: string;
  readonly at: number;
  readonly power: number;
}

export type Line =
  | { readonly t: "blank" }
  /** Prose: a line with nothing to evaluate. Silent, and not an error. */
  | { readonly t: "prose" }
  | { readonly t: "expression"; readonly node: Node }
  | { readonly t: "assignment"; readonly name: string; readonly node: Node };

/** The words that are grammar rather than names. */
const CONVERT = new Set(["in", "to"]);
const TOTAL = new Set(["total", "sum", "subtotal"]);

class Parser {
  private i = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }
  private next(): Token | undefined {
    return this.tokens[this.i++];
  }
  private atEnd(): boolean {
    return this.i >= this.tokens.length;
  }
  /**
   * Whether the token at the cursor is that operator.
   *
   * The one place the two spellings of a power become one. The tokeniser keeps what was
   * written, so an error can quote it back and so a token can always be found at its own
   * offset; the grammar does not care which was typed.
   */
  private isOp(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    if (t?.kind !== "op") return false;
    return t.text === text || (text === "^" && t.text === "**");
  }

  /**
   * Whether the word at the cursor is the conversion keyword rather than the unit `in`.
   *
   * The one genuine ambiguity in the grammar, and the rule is what somebody writing it
   * means: `in` is inches when it follows a bare number, and the keyword when it follows
   * something that already has a unit. So `6 in` is six inches, `3 m in cm` is a
   * conversion, and `6 in in cm` is both, in that order.
   *
   * `to` is never a unit, so it needs none of this.
   */
  private isConversionKeyword(): boolean {
    const t = this.peek();
    if (t?.kind !== "word" || !CONVERT.has(t.text.toLowerCase())) return false;
    if (t.text.toLowerCase() === "to") return true;
    const before = this.tokens[this.i - 1];
    // After a number, `in` is inches. After a unit word, a bracket or nothing, it is the
    // keyword.
    return before?.kind !== "number";
  }

  parseLine(): Line {
    if (this.tokens.length === 0) return { t: "blank" };

    // An assignment is a name, an equals, and the rest. Checked before anything else,
    // because `x = 3` should not parse as a comparison this language does not have.
    const first = this.peek();
    if (first?.kind === "word" && this.isOp("=", 1) && !TOTAL.has(first.text.toLowerCase())) {
      this.i += 2;
      const node = this.parseConversion();
      const extra = this.leftover();
      return { t: "assignment", name: first.text, node: extra ?? node };
    }

    // Prose: nothing on the line could be arithmetic. Silent rather than an error, because
    // a notepad has sentences in it and underlining every one would make it useless.
    if (!this.tokens.some((t) => t.kind === "number" || t.kind === "date" || t.kind === "money")) {
      const onlyWords = this.tokens.every((t) => t.kind === "word" || t.kind === "unknown");
      if (onlyWords && !this.tokens.some((t) => TOTAL.has(t.text.toLowerCase()))) return { t: "prose" };
    }

    const node = this.parseConversion();
    const extra = this.leftover();
    return { t: "expression", node: extra ?? node };
  }

  /** Anything left after a complete expression is a mistake worth naming. */
  private leftover(): Node | undefined {
    if (this.atEnd()) return undefined;
    const t = this.peek()!;
    return { t: "bad", message: `${JSON.stringify(t.text)} is not part of an expression`, at: t.at };
  }

  private parseConversion(): Node {
    const of = this.parseSum();
    if (!this.isConversionKeyword()) return of;
    this.next();
    if (this.atEnd()) {
      return { t: "bad", message: "nothing to convert into", at: this.tokens[this.i - 1]?.at ?? 0 };
    }
    const start = this.i;
    const to = this.parseProduct();
    const wanted = this.tokens
      .slice(start, this.i)
      .map((t) => t.text)
      .join(" ");
    return { t: "convert", of, to, wanted };
  }

  private parseSum(): Node {
    let left = this.parseProduct();
    for (;;) {
      if (this.isOp("+")) {
        this.next();
        left = { t: "bin", op: "+", left, right: this.parseProduct() };
      } else if (this.isOp("-")) {
        this.next();
        left = { t: "bin", op: "-", left, right: this.parseProduct() };
      } else return left;
    }
  }

  /**
   * Multiplication, division, and two things written next to each other.
   *
   * Juxtaposition sits at this precedence rather than tighter, and both of these depend on
   * that: `100 km/h` is `100 * km / h`, which is right, and `1/2 m` is `1 / 2 * m`, which is
   * half a metre rather than the half-per-metre a tighter binding would give.
   *
   * A bare unit word is one of that unit, which is what makes the first of those work: `h`
   * with no number in front of it is one hour, so `km/h` needs no special case anywhere.
   */
  private parseProduct(): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.isOp("*")) {
        this.next();
        left = { t: "bin", op: "*", left, right: this.parseUnary() };
      } else if (this.isOp("/")) {
        this.next();
        left = { t: "bin", op: "/", left, right: this.parseUnary() };
      } else if (this.startsOperand() && !this.isConversionKeyword()) {
        left = { t: "bin", op: "*", left, right: this.parseUnary() };
      } else return left;
    }
  }

  /** Whether what is at the cursor could begin an operand, which is what juxtaposition needs. */
  private startsOperand(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.kind === "word") return !TOTAL.has(t.text.toLowerCase());
    return t.kind === "number" || t.kind === "date" || t.kind === "money" || (t.kind === "op" && t.text === "(");
  }

  private parseUnary(): Node {
    if (this.isOp("-")) {
      this.next();
      return { t: "neg", of: this.parseUnary() };
    }
    if (this.isOp("+")) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  /**
   * The units written directly after a number, if any.
   *
   * Greedy over words, and over `/` only when a unit word follows it directly. That last
   * condition is the whole trick: in `100 km/h` the slash is followed by `h`, so it is part
   * of the unit, and in `240 km / 90 km/h` it is followed by a number, so it is a division
   * and the operand ends at `km`.
   *
   * A word that is not a unit ends the suffix rather than being swallowed, so `3 apples`
   * stays a multiplication by a name and gives the "apples is not defined" that a reader
   * can act on.
   */
  private parseUnitSuffix(): UnitRef[] {
    const out: UnitRef[] = [];
    let inverted = false;

    for (;;) {
      const t = this.peek();
      if (t?.kind === "word" && !CONVERT.has(t.text.toLowerCase()) && !TOTAL.has(t.text.toLowerCase()) && unitFor(t.text)) {
        this.next();
        let power = 1;
        // `m^2`, and only an integer literal: a fractional power of a unit is a dimension
        // the five-tuple cannot hold.
        if (this.isOp("^") && this.peek(1)?.kind === "number" && Number.isInteger(this.peek(1)?.value ?? NaN)) {
          this.next();
          power = this.next()?.value ?? 1;
        }
        out.push({ name: t.text, at: t.at, power: inverted ? -power : power });
        inverted = false;
        continue;
      }

      // A slash continues the unit only when a unit word comes straight after it.
      const slash = this.isOp("/");
      const after = this.peek(1);
      if (slash && after?.kind === "word" && !CONVERT.has(after.text.toLowerCase()) && unitFor(after.text)) {
        this.next();
        inverted = true;
        continue;
      }

      return out;
    }
  }

  private parsePower(): Node {
    const left = this.parseAtom();
    if (!this.isOp("^")) return left;
    this.next();
    // Right associative, and through unary so that `2^-1` reads.
    return { t: "bin", op: "^", left, right: this.parseUnary() };
  }

  private parseAtom(): Node {
    const t = this.next();
    if (!t) return { t: "bad", message: "the line ends before the expression does", at: 0 };

    if (t.kind === "number") {
      // A percent sign binds to the number it follows and to nothing else.
      if (this.peek()?.kind === "percent") {
        this.next();
        return { t: "pct", value: t.value ?? 0 };
      }
      const units = this.parseUnitSuffix();
      if (units.length > 0) return { t: "qty", value: t.value ?? 0, units };
      return { t: "num", value: t.value ?? 0 };
    }

    if (t.kind === "money") {
      // The symbol tags whatever comes next, so `$1,850` and `$ (x + y)` both work.
      return { t: "money", tag: t.text, of: this.parseUnary() };
    }

    if (t.kind === "date") {
      const [year, month, day] = t.text.split("-").map(Number) as [number, number, number];
      return { t: "date", year, month, day };
    }

    if (t.kind === "word") {
      if (TOTAL.has(t.text.toLowerCase())) return { t: "total" };
      return { t: "name", name: t.text, at: t.at };
    }

    if (t.kind === "op" && t.text === "(") {
      const inner = this.parseConversion();
      if (this.isOp(")")) {
        this.next();
        return inner;
      }
      return { t: "bad", message: "a bracket is opened and never closed", at: t.at };
    }

    if (t.kind === "percent") return { t: "bad", message: "a percent sign needs a number before it", at: t.at };

    return { t: "bad", message: `${JSON.stringify(t.text)} cannot start an expression`, at: t.at };
  }
}

/** A line of text, as something the evaluator can walk. Never throws. */
export function parse(line: string): Line {
  return new Parser(tokenise(line)).parseLine();
}
