import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import { dividedBy, into, minus, negate, plus, power, times } from "./arith";
import { displayName, err, isErr, money, num, of, pct, type Qty, type Value } from "./value";
import { unitFor } from "./units";

const u = (name: string) => unitFor(name)!;
const q = (amount: number, name: string) => of(amount, u(name));

/** What a reader would see: the number in its display unit, and the unit. */
function shown(v: Value): string {
  if (v.kind === "error") return `error: ${v.message}`;
  if (v.kind === "pct") return `${v.percent}%`;
  if (v.kind !== "qty") return v.kind;
  let factor = 1;
  for (const x of v.display.over) factor *= x.factor;
  for (const x of v.display.under) factor /= x.factor;
  const n = v.magnitude / factor;
  const rounded = Math.round(n * 1e9) / 1e9;
  return `${v.tag ?? ""}${rounded}${displayName(v.display) ? " " + displayName(v.display) : ""}`;
}

group("adding, and what it refuses", () => {
  test("the same unit adds", () => {
    expect(shown(plus(q(3, "m"), q(2, "m")))).toBe("5 m");
  });

  test("different units of one dimension add, in the unit written first", () => {
    // 3 and 0.4 are added, not 3 and 40: the magnitude is already in base units, so there
    // is no conversion in the hot path at all.
    expect(shown(plus(q(3, "m"), q(40, "cm")))).toBe("3.4 m");
    expect(shown(plus(q(40, "cm"), q(3, "m")))).toBe("340 cm");
  });

  test("different dimensions do not add, and the message says which", () => {
    const r = plus(q(3, "m"), q(2, "kg"));
    expect(isErr(r)).toBe(true);
    expect((r as { message: string }).message).toBe("length and mass do not add");
  });

  test("a plain number does not add to a quantity, not even as a scalar", () => {
    // The coercion that is deliberately absent. `3 m + 2` either meant `3 m + 2 m` or meant
    // something unknowable, and guessing gives a confidently wrong number.
    expect(isErr(plus(q(3, "m"), num(2)))).toBe(true);
    expect(isErr(plus(num(2), q(3, "m")))).toBe(true);
  });

  test("plain numbers add to each other", () => {
    expect(shown(plus(num(3), num(2)))).toBe("5");
  });

  test("a percentage after a quantity is a percentage of it", () => {
    // 132, not 130. This is what `+ 10%` means everywhere outside a programming language.
    expect(shown(plus(num(120), pct(10)))).toBe("132");
    expect(shown(minus(num(120), pct(10)))).toBe("108");
  });

  test("a percentage before a quantity is refused rather than guessed", () => {
    expect(isErr(plus(pct(10), num(120)))).toBe(true);
  });

  test("percentages add to each other", () => {
    expect(shown(plus(pct(10), pct(5)))).toBe("15%");
  });
});

group("money, which is a tag and never a dimension", () => {
  test("the same currency totals, because that is the operation people want", () => {
    expect(shown(plus(money(1850, "$"), money(150, "$")))).toBe("$2000");
  });

  test("two currencies do not add, and the reason is given rather than a rate", () => {
    const r = plus(money(5, "$"), money(5, "€"));
    expect(isErr(r)).toBe(true);
    expect((r as { message: string }).message).toMatch(/no exchange rates/);
  });

  test("money and a plain number do not add", () => {
    expect(isErr(plus(money(5, "$"), num(5)))).toBe(true);
  });

  test("money times a plain number is money", () => {
    expect(shown(times(money(20, "$"), num(3)))).toBe("$60");
    expect(shown(times(num(3), money(20, "$")))).toBe("$60");
  });

  test("money times money is refused, because it is not an amount of money", () => {
    expect(isErr(times(money(20, "$"), money(3, "$")))).toBe(true);
  });

  test("a percentage of money is money", () => {
    expect(shown(times(money(80, "$"), pct(25)))).toBe("$20");
    expect(shown(plus(money(80, "$"), pct(25)))).toBe("$100");
  });

  test("a tag can never be converted, and the refusal names why", () => {
    const r = into(money(5, "$"), { over: [], under: [] }, "€");
    expect(isErr(r)).toBe(true);
    expect((r as { message: string }).message).toMatch(/no exchange rates/);
  });
});

group("multiplying and dividing", () => {
  test("dimensions combine", () => {
    expect(shown(times(q(3, "m"), q(4, "m")))).toBe("12 m²");
    expect(shown(dividedBy(q(100, "km"), q(2, "h")))).toBe("50 km/h");
  });

  test("a quantity over itself is a plain number with no unit left", () => {
    expect(shown(dividedBy(q(10, "m"), q(2, "m")))).toBe("5");
  });

  test("dividing by zero is said, not returned as Infinity", () => {
    // Infinity renders as a number and reads as one, which is the failure mode this whole
    // program exists to avoid.
    const r = dividedBy(q(3, "m"), num(0));
    expect(isErr(r)).toBe(true);
    expect((r as { message: string }).message).toBe("cannot divide by zero");
  });

  test("km/h and mph are the same dimension, so they add without being enumerated as a pair", () => {
    const kmh = dividedBy(q(100, "km"), q(1, "h"));
    const mph = dividedBy(q(60, "mi"), q(1, "h"));
    const sum = plus(kmh, mph);
    expect(isErr(sum)).toBe(false);
    // 100 km/h plus 60 mph, in km/h. 60 miles is 96.56064 km, from the exact 1609.344.
    expect(shown(sum)).toBe("196.56064 km/h");
  });
});

group("powers", () => {
  test("an integer power multiplies the dimension", () => {
    expect(shown(power(q(3, "m"), num(2)))).toBe("9 m²");
  });

  test("a negative power inverts", () => {
    expect(shown(power(num(2), num(-2)))).toBe("0.25");
  });

  test("a fractional power on a dimension is refused, since the tuple cannot hold half a length", () => {
    expect(isErr(power(q(4, "m"), num(0.5)))).toBe(true);
  });

  test("a fractional power on a plain number is fine", () => {
    expect(shown(power(num(9), num(0.5)))).toBe("3");
  });

  test("a dimensioned exponent is refused", () => {
    expect(isErr(power(num(2), q(3, "m")))).toBe(true);
  });
});

group("errors are values, so they propagate without anybody checking", () => {
  const broken = err("line 4 failed", 4);

  test("every operation passes an error straight through", () => {
    for (const op of [plus, minus, times, dividedBy, power]) {
      expect(op(broken, num(1))).toBe(broken);
      expect(op(num(1), broken)).toBe(broken);
    }
    expect(negate(broken)).toBe(broken);
  });

  test("the first error wins, so the message names the earliest cause", () => {
    const later = err("line 9 failed", 9);
    expect(plus(broken, later)).toBe(broken);
  });

  test("nothing here throws, on any pair of values", () => {
    const values: Value[] = [
      num(3), q(2, "m"), q(1, "kg"), money(5, "$"), money(5, "€"), pct(10),
      { kind: "date", year: 2026, month: 9, day: 10 },
      { kind: "cal", months: 3 },
      { kind: "none" },
      broken,
    ];
    for (const a of values) for (const b of values) {
      for (const op of [plus, minus, times, dividedBy, power]) {
        expect(() => op(a, b)).not.toThrow();
      }
    }
  });
});

group("properties", () => {
  const amount = () => fc.double({ min: -1e6, max: 1e6, noNaN: true });

  test("a dimensional mismatch always errors and never yields a number", () => {
    // The property that makes `3 m + 2 kg` impossible to get a number out of, rather than
    // unlikely to.
    fc.assert(
      fc.property(amount(), amount(), (x, y) => {
        expect(isErr(plus(q(x, "m"), q(y, "kg")))).toBe(true);
        expect(isErr(minus(q(x, "m"), q(y, "kg")))).toBe(true);
      }),
    );
  });

  test("adding is commutative in magnitude", () => {
    fc.assert(
      fc.property(amount(), amount(), (x, y) => {
        const left = plus(q(x, "m"), q(y, "m")) as Qty;
        const right = plus(q(y, "m"), q(x, "m")) as Qty;
        expect(left.magnitude).toBeCloseTo(right.magnitude, 6);
      }),
    );
  });

  test("multiplying by one changes nothing", () => {
    fc.assert(
      fc.property(amount(), (x) => {
        expect((times(q(x, "m"), num(1)) as Qty).magnitude).toBe(q(x, "m").magnitude);
      }),
    );
  });

  test("a value divided by itself is one, whatever it was of", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1e6, noNaN: true }),
        fc.constantFrom("m", "kg", "s", "MB", "mi"),
        (x, unit) => {
          const r = dividedBy(q(x, unit), q(x, unit)) as Qty;
          expect(r.magnitude).toBeCloseTo(1, 9);
        },
      ),
    );
  });
});
