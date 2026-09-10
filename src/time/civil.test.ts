import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import { addDays, addMonths, between, daysInMonth, fromDays, isLeap, toDays, valid, weekday } from "./civil";

const anyDate = fc
  .record({ year: fc.integer({ min: 1600, max: 2400 }), month: fc.integer({ min: 1, max: 12 }) })
  .chain((d) => fc.integer({ min: 1, max: daysInMonth(d.year, d.month) }).map((day) => ({ ...d, day })));

group("the day count", () => {
  test("the epoch is day zero", () => {
    expect(toDays({ year: 1970, month: 1, day: 1 })).toBe(0);
  });

  test("known dates", () => {
    expect(toDays({ year: 2000, month: 3, day: 1 })).toBe(11017);
    expect(toDays({ year: 1969, month: 12, day: 31 })).toBe(-1);
  });

  test("it round-trips for every date in four centuries", () => {
    fc.assert(fc.property(anyDate, (d) => {
      expect(fromDays(toDays(d))).toEqual(d);
    }));
  });

  test("consecutive days are consecutive numbers, across every month and year boundary", () => {
    fc.assert(fc.property(anyDate, (d) => {
      expect(toDays(addDays(d, 1)) - toDays(d)).toBe(1);
    }));
  });
});

group("leap years, which are decided in exactly one place", () => {
  test("the rule", () => {
    expect(isLeap(2024)).toBe(true);
    expect(isLeap(2026)).toBe(false);
    expect(isLeap(1900)).toBe(false);
    expect(isLeap(2000)).toBe(true);
  });

  test("February follows it", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
  });
});

group("adding days, which cannot be affected by daylight saving", () => {
  test("three weeks from a date", () => {
    expect(addDays({ year: 2026, month: 9, day: 10 }, 21)).toEqual({ year: 2026, month: 10, day: 1 });
  });

  test("across the spring clock change, which is the whole point", () => {
    // A date plus one day is the next date, always. An instant plus 86400000 ms is not, and
    // that difference is the entire reason dates here carry no instant.
    expect(addDays({ year: 2026, month: 3, day: 7 }, 1)).toEqual({ year: 2026, month: 3, day: 8 });
    expect(addDays({ year: 2026, month: 3, day: 8 }, 1)).toEqual({ year: 2026, month: 3, day: 9 });
  });

  test("adding then subtracting returns", () => {
    fc.assert(fc.property(anyDate, fc.integer({ min: -5000, max: 5000 }), (d, n) => {
      expect(addDays(addDays(d, n), -n)).toEqual(d);
    }));
  });
});

group("adding months, which clamps", () => {
  test("31 January plus a month is the end of February", () => {
    // No answer here is not a convention. Clamping is the one every calendar uses, and
    // rolling over into March would surprise everybody.
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({ year: 2024, month: 2, day: 29 });
  });

  test("31 May plus a month is 30 June", () => {
    expect(addMonths({ year: 2026, month: 5, day: 31 }, 1)).toEqual({ year: 2026, month: 6, day: 30 });
  });

  test("twelve months is a year, and it crosses correctly backwards too", () => {
    expect(addMonths({ year: 2026, month: 9, day: 10 }, 12)).toEqual({ year: 2027, month: 9, day: 10 });
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({ year: 2025, month: 12, day: 15 });
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -13)).toEqual({ year: 2024, month: 12, day: 15 });
  });

  test("clamping means adding months is not reversible, and that is correct", () => {
    // 31 Jan + 1 month - 1 month is 28 Jan, not 31. Pinned because somebody will read it as
    // a bug and 'fix' it by carrying the original day, which breaks the clamp.
    const jan31 = { year: 2026, month: 1, day: 31 };
    expect(addMonths(addMonths(jan31, 1), -1)).toEqual({ year: 2026, month: 1, day: 28 });
  });

  test("the result is always a real date", () => {
    fc.assert(fc.property(anyDate, fc.integer({ min: -60, max: 60 }), (d, n) => {
      expect(valid(addMonths(d, n))).toBeUndefined();
    }));
  });
});

group("checking a date is one", () => {
  test("a day past the end of its month is refused rather than rolled over", () => {
    // Date in JavaScript turns 2026-02-30 into 2026-03-02 without a word, which is how a
    // typo becomes a plausible wrong answer.
    expect(valid({ year: 2026, month: 2, day: 30 })).toMatch(/28 days/);
    expect(valid({ year: 2024, month: 2, day: 30 })).toMatch(/29 days/);
    expect(valid({ year: 2026, month: 4, day: 31 })).toMatch(/30 days/);
  });

  test("a month outside one to twelve", () => {
    expect(valid({ year: 2026, month: 13, day: 1 })).toMatch(/no month 13/);
    expect(valid({ year: 2026, month: 0, day: 1 })).toMatch(/no month 0/);
  });

  test("a real date is fine", () => {
    fc.assert(fc.property(anyDate, (d) => {
      expect(valid(d)).toBeUndefined();
    }));
  });
});

group("between, and weekday", () => {
  test("days between two dates", () => {
    expect(between({ year: 2026, month: 9, day: 10 }, { year: 2026, month: 10, day: 1 })).toBe(21);
  });

  test("it is signed, so an earlier date is negative", () => {
    expect(between({ year: 2026, month: 10, day: 1 }, { year: 2026, month: 9, day: 10 })).toBe(-21);
  });

  test("a date is zero days from itself", () => {
    fc.assert(fc.property(anyDate, (d) => {
      expect(between(d, d)).toBe(0);
    }));
  });

  test("weekdays, checked against dates whose day is known", () => {
    expect(weekday({ year: 1970, month: 1, day: 1 })).toBe(4); // a Thursday
    expect(weekday({ year: 2026, month: 9, day: 10 })).toBe(4); // also a Thursday
    expect(weekday({ year: 2000, month: 1, day: 1 })).toBe(6); // a Saturday
  });

  test("weekday is always one of seven, never negative", () => {
    fc.assert(fc.property(anyDate, (d) => {
      const w = weekday(d);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(7);
    }));
  });
});
