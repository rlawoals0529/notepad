import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import { format } from "./format";
import { cal, date, err, money, none, num, of, pct } from "./value/value";
import { unitFor } from "./value/units";

group("numbers", () => {
  test("floating point noise is rounded away for reading, not for storage", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in memory. Showing that is noise; storing the
    // rounded value instead would make every later line wrong by a little.
    expect(format(num(0.1 + 0.2))).toBe("0.3");
  });

  test("thousands are grouped, because these are figures people read aloud", () => {
    expect(format(num(1234567))).toBe("1,234,567");
    expect(format(num(1234.5))).toBe("1,234.5");
  });

  test("only the integer part is grouped", () => {
    expect(format(num(0.123456))).toBe("0.123456");
  });

  test("very large and very small go to exponent form", () => {
    expect(format(num(1e20))).toMatch(/e20/);
    expect(format(num(1e-12))).toMatch(/e-12/);
  });

  test("zero is zero, not minus zero or a rounding of one", () => {
    expect(format(num(0))).toBe("0");
    expect(format(num(-0))).toBe("0");
  });
});

group("money shows no decimals or exactly two, never one", () => {
  test("the cases", () => {
    // `$9.8` is not a price anybody has written down.
    expect(format(money(9.8, "$"))).toBe("$9.80");
    expect(format(money(35, "$"))).toBe("$35");
    expect(format(money(107.2, "$"))).toBe("$107.20");
  });

  test("more precision than two decimals is kept, because rounding it would invent a number", () => {
    expect(format(money(0.005, "$"))).toBe("$0.005");
  });

  test("the symbol is whatever was typed, since a tag is never interpreted", () => {
    for (const symbol of ["$", "€", "£", "¥"]) expect(format(money(5, symbol))).toBe(`${symbol}5`);
  });
});

group("quantities", () => {
  test("the number and its unit", () => {
    expect(format(of(3, unitFor("m")!))).toBe("3 m");
    expect(format(of(2.5, unitFor("kg")!))).toBe("2.5 kg");
  });

  test("a percentage keeps its sign", () => {
    expect(format(pct(20))).toBe("20%");
  });
});

group("dates and calendar amounts", () => {
  test("short forms, because the margin is narrow and an elided answer is not an answer", () => {
    expect(format(date(2026, 9, 12))).toBe("Sat 12 Sep 2026");
    expect(format(date(2026, 10, 3))).toBe("Sat 3 Oct 2026");
  });

  test("the weekday is right, checked against days that are known", () => {
    expect(format(date(1970, 1, 1))).toMatch(/^Thu/);
    expect(format(date(2000, 1, 1))).toMatch(/^Sat/);
  });

  test("months and years, singular and plural", () => {
    expect(format(cal(1))).toBe("1 month");
    expect(format(cal(3))).toBe("3 months");
    expect(format(cal(12))).toBe("1 year");
    expect(format(cal(24))).toBe("2 years");
  });
});

group("the rule that carries the whole design", () => {
  test("an error renders as words and never as a figure", () => {
    // The one branch that would have to be edited for this program to show a wrong number.
    const said = format(err("length and mass do not add"));
    expect(said).toBe("length and mass do not add");
    expect(said).not.toMatch(/\d/);
  });

  test("nothing renders as nothing, not as zero", () => {
    expect(format(none)).toBe("");
  });

  test("an infinite or non-finite magnitude is said, not printed as a number", () => {
    // Infinity renders as "Infinity" through String(), which reads as a value.
    expect(format(num(Infinity))).toBe("not a number");
    expect(format(num(NaN))).toBe("not a number");
  });

  test("every value formats to a string with no placeholder text in it", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: -1e9, max: 1e9 }), (n) => {
        for (const v of [num(n), money(n, "$"), pct(n), of(n, unitFor("km")!)]) {
          const said = format(v);
          expect(typeof said).toBe("string");
          expect(said).not.toMatch(/undefined|\[object|NaN/);
        }
      }),
    );
  });
});
