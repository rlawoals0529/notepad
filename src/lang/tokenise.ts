/**
 * A line, as a flat list of tokens.
 *
 * **This does not decide what a word means.** `m` might be metres or a variable somebody
 * named `m`, and `in` might be inches or the word in `3 m in cm`. Both questions need to
 * know what else is on the line, and answering them here would spread that knowledge across
 * two files. The tokeniser says "word", and one place downstream decides which kind.
 *
 * Total, like everything else: any string tokenises. A character it does not recognise
 * becomes an `unknown` token rather than an exception, so the parser gets to produce the
 * error, in the same shape as every other error.
 */

export type TokenKind = "number" | "word" | "op" | "money" | "percent" | "date" | "unknown";

export interface Token {
  readonly kind: TokenKind;
  /** Exactly what was written, so an error can quote it back. */
  readonly text: string;
  /** Where it starts, for pointing at it. */
  readonly at: number;
  /** For numbers, the parsed value. Absent otherwise. */
  readonly value?: number;
}

/** The symbols that mean money. A tag is the symbol itself, so nothing has to name them. */
const MONEY = new Set(["$", "€", "£", "¥", "₹", "₩"]);

/** Single-character operators. `**` is handled separately because it is two. */
const OPERATORS = new Set(["+", "-", "*", "/", "^", "(", ")", "="]);

const isDigit = (c: string) => c >= "0" && c <= "9";
/** A word starts with a letter or underscore. A degree sign counts, since `°` is a unit. */
const startsWord = (c: string) => /[\p{L}_°]/u.test(c);
const continuesWord = (c: string) => /[\p{L}\p{N}_°]/u.test(c);

export function tokenise(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const c = line[i]!;

    if (c === " " || c === "\t") {
      i++;
      continue;
    }

    // A date literal, before numbers, or `2026-09-10` reads as 2026 minus 9 minus 10.
    const date = /^\d{4}-\d{2}-\d{2}/.exec(line.slice(i));
    if (date) {
      out.push({ kind: "date", text: date[0], at: i });
      i += date[0].length;
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(line[i + 1] ?? ""))) {
      const read = readNumber(line, i);
      out.push({ kind: "number", text: read.text, at: i, value: read.value });
      i += read.text.length;
      continue;
    }

    if (MONEY.has(c)) {
      out.push({ kind: "money", text: c, at: i });
      i++;
      continue;
    }

    if (c === "%") {
      out.push({ kind: "percent", text: c, at: i });
      i++;
      continue;
    }

    /**
     * `**` as a second spelling of `^`, because somebody will type it.
     *
     * The token keeps the text that was written rather than the one it means. Emitting
     * `"^"` here made the token's text disagree with the two characters at its own offset,
     * which breaks the one invariant every token has: that it can be found in the line it
     * came from. A property caught it, once, on an input a generator happened to produce;
     * the same input is now pinned below the property so it cannot go quiet again.
     *
     * The parser is where the two spellings become one, in `isOp`.
     */
    if (c === "*" && line[i + 1] === "*") {
      out.push({ kind: "op", text: "**", at: i });
      i += 2;
      continue;
    }

    if (OPERATORS.has(c)) {
      out.push({ kind: "op", text: c, at: i });
      i++;
      continue;
    }

    if (startsWord(c)) {
      let j = i + 1;
      while (j < line.length && continuesWord(line[j]!)) j++;
      out.push({ kind: "word", text: line.slice(i, j), at: i });
      i = j;
      continue;
    }

    // Not recognised. One token per character, so the message can point at exactly one.
    out.push({ kind: "unknown", text: c, at: i });
    i++;
  }

  return out;
}

/**
 * A number, including thousands separators and an exponent.
 *
 * `1,234.5` is read as one number, because a notepad is where people paste figures that
 * came out of a spreadsheet. A comma is only a separator when digits follow it, so
 * `1,234` is a number and `f(1, 2)` would not be, if this had functions.
 */
function readNumber(line: string, start: number): { text: string; value: number } {
  let i = start;
  while (i < line.length) {
    const c = line[i]!;
    if (isDigit(c)) i++;
    else if (c === "," && isDigit(line[i + 1] ?? "")) i++;
    else break;
  }
  if (line[i] === "." && isDigit(line[i + 1] ?? "")) {
    i++;
    while (i < line.length && isDigit(line[i]!)) i++;
  }
  // An exponent, and only when it is complete: `2e` is the number 2 followed by a word,
  // which is what somebody writing `2 euros` shortened badly would want.
  const exponent = /^[eE][+-]?\d+/.exec(line.slice(i));
  if (exponent) i += exponent[0].length;

  const text = line.slice(start, i);
  return { text, value: Number(text.replace(/,/g, "")) };
}
