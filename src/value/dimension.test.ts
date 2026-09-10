import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import {
  ANGLE, DATA, LENGTH, MASS, SCALAR, TIME,
  add, describe, isScalar, same, scale, sub,
  type Dimension,
} from "./dimension";

const exponent = () => fc.integer({ min: -4, max: 4 });
// Written out rather than built with Array.from, so the type is a five-tuple and not a
// number[] that has to be asserted into one.
const anyDimension: fc.Arbitrary<Dimension> = fc.tuple(exponent(), exponent(), exponent(), exponent(), exponent());

group("compatibility", () => {
  test("a dimension equals itself and nothing else", () => {
    const all = [SCALAR, LENGTH, MASS, TIME, DATA, ANGLE];
    for (const a of all) for (const b of all) expect(same(a, b)).toBe(a === b);
  });

  test("length and mass are not compatible, which is what makes 3 m + 2 kg an error", () => {
    // By construction rather than by a check somebody has to remember to write. This is the
    // assertion that would have to be deleted for that error to become a number.
    expect(same(LENGTH, MASS)).toBe(false);
  });

  test("a plain number is the zero dimension", () => {
    expect(isScalar(SCALAR)).toBe(true);
    expect(isScalar(LENGTH)).toBe(false);
  });

  test("a duration is just the time dimension, not a kind of its own", () => {
    // The collapse that deletes two branches from the value type: a duration is a quantity,
    // so `3 weeks + 2 days` needs no rule beyond the one every quantity already has.
    expect(same(TIME, [0, 0, 1, 0, 0])).toBe(true);
  });
});

group("arithmetic on dimensions", () => {
  test("multiplying adds, so a length times a length is an area", () => {
    expect(add(LENGTH, LENGTH)).toEqual([2, 0, 0, 0, 0]);
  });

  test("dividing subtracts, which is where km/h comes from", () => {
    expect(sub(LENGTH, TIME)).toEqual([1, 0, -1, 0, 0]);
  });

  test("a quantity over itself is a plain number", () => {
    // The thing that makes a ratio dimensionless without a rule for ratios.
    expect(isScalar(sub(LENGTH, LENGTH))).toBe(true);
  });

  test("raising to a power multiplies", () => {
    expect(scale(LENGTH, 3)).toEqual([3, 0, 0, 0, 0]);
    expect(scale(sub(LENGTH, TIME), 2)).toEqual([2, 0, -2, 0, 0]);
  });

  test("multiplying by a plain number changes nothing", () => {
    // A block body, not an expression one. fast-check reads the returned value, and an
    // expression arrow hands it whatever expect() returns, which fails the property while
    // the assertion inside it passes.
    fc.assert(
      fc.property(anyDimension, (d) => {
        expect(add(d, SCALAR)).toEqual([...d]);
      }),
    );
  });

  test("dividing then multiplying by the same thing returns", () => {
    fc.assert(
      fc.property(anyDimension, anyDimension, (a, b) => {
        expect(add(sub(a, b), b)).toEqual([...a]);
      }),
    );
  });
});

group("saying it in words, because the message is all the user gets", () => {
  test("the plain cases", () => {
    expect(describe(SCALAR)).toBe("a plain number");
    expect(describe(LENGTH)).toBe("length");
    expect(describe(TIME)).toBe("time");
  });

  test("a power reads as a superscript, since the answer column is prose", () => {
    expect(describe(scale(LENGTH, 2))).toBe("length²");
    expect(describe(scale(LENGTH, 3))).toBe("length³");
  });

  test("a rate reads as a division", () => {
    expect(describe(sub(LENGTH, TIME))).toBe("length/time");
    expect(describe(sub(add(LENGTH, LENGTH), scale(TIME, 2)))).toBe("length²/time²");
  });

  test("nothing on top reads as per, not as one over", () => {
    // "per time" is how a rate with no numerator is said out loud; "1/time" is how it is
    // written on a whiteboard, and this ends up in a sentence.
    expect(describe(scale(TIME, -1))).toBe("per time");
  });

  test("every dimension describes as something, and never as a tuple", () => {
    fc.assert(
      fc.property(anyDimension, (d) => {
        const said = describe(d);
        expect(said.length).toBeGreaterThan(0);
        expect(said).not.toMatch(/[[\],]/);
      }),
    );
  });
});
