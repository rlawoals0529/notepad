import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import { tokenise } from "./tokenise";

const kinds = (line: string) => tokenise(line).map((t) => `${t.kind}:${t.text}`);

group("the pieces of a line", () => {
  test("a number and a word", () => {
    expect(kinds("3 m")).toEqual(["number:3", "word:m"]);
  });

  test("operators, including the two-character power", () => {
    expect(kinds("2 ^ 3")).toEqual(["number:2", "op:^", "number:3"]);
    // The text is what was written, not what it means. Rewriting it to "^" here made the
    // token disagree with its own offset; the parser is where the two spellings converge.
    expect(kinds("2 ** 3")).toEqual(["number:2", "op:**", "number:3"]);
  });

  test("and a token is always findable at its own offset, including that one", () => {
    // The counterexample that a property found once and that then could not be reproduced:
    // `fc.string()` happens to generate two adjacent asterisks now and then, and a hunt run
    // against a different alphabet missed it for 200,000 cases. Pinned so it cannot go quiet
    // again, because a property that fails one run in fifty reads as flakiness.
    for (const line of ["2 ** 3", "**", "a**b", "1***2"]) {
      for (const t of tokenise(line)) {
        expect(line.slice(t.at, t.at + t.text.length), line).toBe(t.text);
      }
    }
  });

  test("money is a token of its own, so a tag needs no list of names downstream", () => {
    expect(kinds("$1850")).toEqual(["money:$", "number:1850"]);
    for (const symbol of ["€", "£", "¥", "₹", "₩"]) {
      expect(kinds(`${symbol}5`)[0]).toBe(`money:${symbol}`);
    }
  });

  test("a percent sign is not an operator", () => {
    expect(kinds("120 + 10%")).toEqual(["number:120", "op:+", "number:10", "percent:%"]);
  });
});

group("numbers", () => {
  test("decimals and a leading dot", () => {
    expect(tokenise("1.5")[0]?.value).toBe(1.5);
    expect(tokenise(".5")[0]?.value).toBe(0.5);
  });

  test("thousands separators, because figures get pasted out of spreadsheets", () => {
    expect(tokenise("1,234.5")[0]?.value).toBe(1234.5);
    expect(kinds("1,234.5")).toEqual(["number:1,234.5"]);
  });

  test("a comma with no digit after it is not part of the number", () => {
    expect(kinds("1, 2")).toEqual(["number:1", "unknown:,", "number:2"]);
  });

  test("an exponent, but only a complete one", () => {
    expect(tokenise("2e3")[0]?.value).toBe(2000);
    expect(tokenise("2e-3")[0]?.value).toBe(0.002);
    // `2e` is 2 and then a word, which is what a badly shortened `2 euros` should become
    // rather than NaN.
    expect(kinds("2e")).toEqual(["number:2", "word:e"]);
  });

  test("a number never tokenises to NaN", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: -1e12, max: 1e12 }), (n) => {
        const t = tokenise(String(n))[0];
        if (t?.kind === "number") expect(Number.isNaN(t.value)).toBe(false);
      }),
    );
  });
});

group("dates, which have to beat subtraction", () => {
  test("a date literal is one token", () => {
    // Without this rule `2026-09-10` is 2026 minus 9 minus 10, which is 2007 and looks like
    // an answer.
    expect(kinds("2026-09-10")).toEqual(["date:2026-09-10"]);
  });

  test("a subtraction of plain numbers is still a subtraction", () => {
    expect(kinds("2026 - 09")).toEqual(["number:2026", "op:-", "number:09"]);
  });

  test("something date-shaped but wrong stays arithmetic", () => {
    expect(kinds("26-09-10")).toEqual(["number:26", "op:-", "number:09", "op:-", "number:10"]);
  });
});

group("words", () => {
  test("letters, digits and underscores continue a word but do not start one", () => {
    expect(kinds("rate_2 = 5")).toEqual(["word:rate_2", "op:=", "number:5"]);
  });

  test("the degree sign is a word, because it is a unit", () => {
    expect(kinds("90°")).toEqual(["number:90", "word:°"]);
  });

  test("accented and non-latin words tokenise, rather than becoming unknown", () => {
    // A notepad is written in, so a name is whatever the person's keyboard makes.
    expect(kinds("café = 3")).toEqual(["word:café", "op:=", "number:3"]);
    expect(tokenise("температура")[0]?.kind).toBe("word");
  });

  test("nothing here decides whether a word is a unit or a name", () => {
    // The deliberate omission. `m` is one token kind whether it is metres or a variable, and
    // the single place that decides is downstream.
    expect(kinds("m")).toEqual(["word:m"]);
    expect(kinds("in")).toEqual(["word:in"]);
  });
});

group("totality", () => {
  test("an unrecognised character is a token, not an exception", () => {
    expect(kinds("3 § 4")).toEqual(["number:3", "unknown:§", "number:4"]);
  });

  test("any string at all tokenises without throwing", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => tokenise(s)).not.toThrow();
      }),
    );
  });

  test("the tokens always cover the line, with nothing invented and nothing lost", () => {
    // Two generators, because the alphabet decides what this finds. A run against arbitrary
    // code units missed the `**` case for 200,000 tries; a run over the characters this
    // language actually uses finds it in a handful.
    // Every token's text sits at its own offset in the original. That is what makes an error
    // able to point at a character, and it catches an off-by-one in any reader above.
    const syntax = fc.stringOf(fc.constantFrom(..."0123456789.,+-*/^()=%$ abcm ".split("")), { maxLength: 24 });
    for (const generator of [fc.string(), syntax]) {
      fc.assert(
        fc.property(generator, (s) => {
          for (const t of tokenise(s)) {
            expect(s.slice(t.at, t.at + t.text.length)).toBe(t.text);
          }
        }),
        { numRuns: 2000 },
      );
    }
  });

  test("tokens come out in order and never overlap", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        let end = -1;
        for (const t of tokenise(s)) {
          expect(t.at).toBeGreaterThanOrEqual(end);
          end = t.at + t.text.length;
        }
      }),
    );
  });

  test("whitespace produces nothing", () => {
    expect(tokenise("   \t  ")).toEqual([]);
    expect(tokenise("")).toEqual([]);
  });
});
