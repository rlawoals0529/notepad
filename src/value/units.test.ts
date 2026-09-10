import { describe as group, expect, test } from "vitest";
import { allUnits, isUnit, refusalFor, unitFor } from "./units";
import { DATA, LENGTH, MASS, TIME, same } from "./dimension";

group("the constants, pinned against the standards that define them", () => {
  /**
   * These are the tests a round-trip cannot replace, and that is the whole point of writing
   * them out. `x in lb in kg in lb` returns to x whatever the pound is set to, because a
   * wrong constant is perfectly self-consistent. Only a number checked against the outside
   * world catches `0.4536`.
   */
  test("the international pound is exactly 0.45359237 kg", () => {
    expect(unitFor("lb")?.factor).toBe(0.45359237);
  });

  test("the international inch is exactly 0.0254 m", () => {
    expect(unitFor("in")?.factor).toBe(0.0254);
  });

  test("the imperial lengths are derived from the inch, so they cannot drift from it", () => {
    const inch = unitFor("in")!.factor;
    expect(unitFor("ft")?.factor).toBeCloseTo(inch * 12, 12);
    expect(unitFor("yd")?.factor).toBeCloseTo(inch * 36, 12);
    expect(unitFor("mi")?.factor).toBeCloseTo(inch * 12 * 5280, 9);
  });

  test("the imperial masses are derived from the pound", () => {
    const lb = unitFor("lb")!.factor;
    expect(unitFor("oz")?.factor).toBe(lb / 16);
    expect(unitFor("st")?.factor).toBe(lb * 14);
  });

  test("a day is 86400 seconds and a week is seven of them", () => {
    // True for a duration, which is all this is. It is emphatically not true of a calendar
    // day across a daylight saving change, which is why dates do not use this table.
    expect(unitFor("day")?.factor).toBe(86400);
    expect(unitFor("week")?.factor).toBe(86400 * 7);
  });

  test("kB is 1000 and KiB is 1024, and they are different units", () => {
    // The whole reason the IEC prefixes exist. Collapsing them is how a tool reports a disk
    // as the wrong size and sounds certain about it.
    expect(unitFor("kB")?.factor).toBe(1000);
    expect(unitFor("KiB")?.factor).toBe(1024);
    expect(unitFor("MiB")?.factor).toBe(1024 * 1024);
    expect(unitFor("kB")).not.toBe(unitFor("KiB"));
  });

  test("a degree is pi over 180 radians", () => {
    expect(unitFor("deg")?.factor).toBe(Math.PI / 180);
  });

  test("the gram is a thousandth, because the SI base for mass already has a prefix", () => {
    expect(unitFor("kg")?.factor).toBe(1);
    expect(unitFor("g")?.factor).toBe(0.001);
  });
});

group("finding a unit by what somebody typed", () => {
  test("the name, the plural and the long form all work", () => {
    for (const spelling of ["km", "KM", "kilometre", "kilometres", "kilometer", "kilometers"]) {
      expect(unitFor(spelling)?.name).toBe("km");
    }
  });

  test("case does not matter, because KM and km are the same distance", () => {
    expect(unitFor("KG")).toBe(unitFor("kg"));
    expect(unitFor("Miles")).toBe(unitFor("mi"));
  });

  test("a word that is not a unit is undefined, not a guess", () => {
    for (const word of ["apples", "widgets", "x", "", "  ", "furlong"]) {
      expect(unitFor(word)).toBeUndefined();
      expect(isUnit(word)).toBe(false);
    }
  });

  test("a prototype member is a word like any other, not a unit", () => {
    // These are things a person writes in a notepad, and the table is a Map for exactly
    // this reason: an object indexed by typed text hands back a function.
    for (const word of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(unitFor(word)).toBeUndefined();
    }
  });
});

group("bits are refused rather than silently read as bytes", () => {
  test("the ambiguous spellings say what to write instead", () => {
    for (const spelling of ["Mb", "Gb", "kb", "Tb"]) {
      const why = refusalFor(spelling);
      expect(why).toMatch(/ambiguous/);
      expect(why).toMatch(/bytes/);
      expect(unitFor(spelling)).toBeUndefined();
    }
  });

  test("the spelled-out ones too", () => {
    expect(refusalFor("megabit")).toMatch(/bits are not supported/);
    expect(refusalFor("Gigabit")).toMatch(/bits are not supported/);
  });

  test("this is an 8x error, which is why it is refused rather than guessed", () => {
    // Without the refusal, `100 Mb` would have read as 100 megabytes: eight times the
    // answer, with nothing on screen saying an assumption was made.
    expect(unitFor("MB")?.factor).toBe(1e6);
    expect(unitFor("Mb")).toBeUndefined();
  });

  test("a lone b is left alone, because it is far more likely to be a variable", () => {
    expect(refusalFor("b")).toBeUndefined();
    expect(refusalFor("B")).toBeUndefined();
  });

  test("MB itself still works, and so does every unambiguous data unit", () => {
    for (const spelling of ["B", "kB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"]) {
      expect(unitFor(spelling), spelling).toBeDefined();
    }
  });
});

group("the table itself", () => {
  test("every dimension has exactly one base unit", () => {
    // A second unit with a factor of 1 in one dimension means two spellings both claiming
    // to be the base, and whichever loses a rounding is unfindable.
    for (const dim of [LENGTH, MASS, TIME, DATA]) {
      const bases = allUnits().filter((u) => same(u.dimension, dim) && u.factor === 1);
      expect(bases.map((u) => u.name)).toHaveLength(1);
    }
  });

  test("every factor is positive and finite", () => {
    for (const u of allUnits()) {
      expect(Number.isFinite(u.factor), u.name).toBe(true);
      expect(u.factor, u.name).toBeGreaterThan(0);
    }
  });

  test("no spelling is claimed by two units", () => {
    // The module throws at load if one is, so reaching this line at all is half the test.
    // The other half is that the count matches, which catches an alias silently swallowed.
    const spellings = allUnits().flatMap((u) => [u.name, ...u.aliases].map((s) => s.toLowerCase()));
    expect(new Set(spellings).size).toBe(spellings.length);
  });

  test("every unit is findable by its own name", () => {
    for (const u of allUnits()) expect(unitFor(u.name), u.name).toBe(u);
  });

  test("temperature is not in the table, and that is deliberate", () => {
    // Celsius to Fahrenheit is affine, not a factor, so it cannot be a row here without
    // making every other row a special case. Pinned so adding one is a deliberate act.
    for (const spelling of ["C", "celsius", "F", "fahrenheit", "K", "kelvin"]) {
      expect(unitFor(spelling), spelling).toBeUndefined();
    }
  });

  test("months and years are not durations", () => {
    // A month is not a fixed number of seconds. Putting one here would encode that it is,
    // and every answer that used it would be quietly wrong.
    for (const spelling of ["month", "months", "year", "years", "yr"]) {
      expect(unitFor(spelling), spelling).toBeUndefined();
    }
  });
});
