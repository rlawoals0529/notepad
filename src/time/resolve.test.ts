import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normaliseHour, resolve, suggestionFor, wallAt, type Wall } from "./resolve";

const wall = (year: number, month: number, day: number, hour: number, minute = 0): Wall => ({
  year,
  month,
  day,
  hour,
  minute,
});

describe("the three cases that made this necessary", () => {
  it("refuses a time the clocks skipped over, in New York", () => {
    // The naive two-pass algorithm returns an instant that reads back as 03:30 here, and
    // says nothing about having moved it. Measured against this engine, not assumed.
    const r = resolve(wall(2026, 3, 8, 2, 30), "America/New_York");
    expect(r.kind).toBe("gap");
    if (r.kind === "gap") {
      expect(r.skippedFrom).toBe("02:00");
      expect(r.skippedTo).toBe("03:00");
    }
  });

  it("refuses a half-hour skip too, with no special case for its size", () => {
    // Lord Howe moves by thirty minutes, so 02:15 does not exist on that date. The naive
    // version returns an instant reading back as 01:45. Nothing in the resolver knows how
    // large a transition is, which is why this needed no extra code.
    const r = resolve(wall(2026, 10, 4, 2, 15), "Australia/Lord_Howe");
    expect(r.kind).toBe("gap");
  });

  it("reports both instants when the clocks went back, rather than picking one", () => {
    // 01:30 happens twice in New York on this date. The naive version returns one of them
    // and never mentions the other, which is the failure that is hardest to notice, because
    // the answer it gives is a real time.
    const r = resolve(wall(2026, 11, 1, 1, 30), "America/New_York");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      // An hour apart, and the earlier one is offered.
      expect(r.other - r.instant).toBe(3_600_000);
      expect(r.instant).toBeLessThan(r.other);
      // Both really do read back as 01:30, which is what makes it ambiguous rather than
      // one of them simply being wrong.
      expect(wallAt(r.instant, "America/New_York")?.hour).toBe(1);
      expect(wallAt(r.other, "America/New_York")?.hour).toBe(1);
    }
  });

  it("an ordinary time resolves to one instant", () => {
    const r = resolve(wall(2026, 6, 15, 14, 0), "Europe/London");
    expect(r.kind).toBe("unique");
    if (r.kind === "unique") {
      // London is on BST in June, so 14:00 local is 13:00 UTC.
      expect(new Date(r.instant).toISOString()).toBe("2026-06-15T13:00:00.000Z");
    }
  });
});

describe("soundness, which is the property that makes a gap impossible to return", () => {
  it("a resolved instant always reads back as exactly what was asked for", () => {
    // This is the one that matters. Whatever the arithmetic did, an answer is only an answer
    // if the zone agrees it is that wall time. Returning the 02:30 that does not exist is
    // impossible while this holds.
    const zones = [
      "America/New_York",
      "Europe/London",
      "Australia/Lord_Howe",
      "Asia/Kathmandu",
      "Pacific/Kiritimati",
      "Pacific/Midway",
      "Asia/Tokyo",
      "America/Santiago",
      "Australia/Sydney",
      "Europe/Dublin",
      "UTC",
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...zones),
        fc.integer({ min: 1970, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 23 }),
        fc.constantFrom(0, 15, 30, 45),
        (zone, year, month, day, hour, minute) => {
          const w = wall(year, month, day, hour, minute);
          const r = resolve(w, zone);
          if (r.kind !== "unique" && r.kind !== "ambiguous") return;
          const back = wallAt(r.instant, zone);
          expect(back).toEqual(w);
          if (r.kind === "ambiguous") expect(wallAt(r.other, zone)).toEqual(w);
        },
      ),
      { numRuns: 1500 },
    );
  });

  it("every transition day in a shifting zone is either resolved or refused, never wrong", () => {
    // Walked minute by minute across the two days a year that break this, in a zone that
    // shifts by an hour and one that shifts by half of one.
    for (const [zone, year, month, day] of [
      ["America/New_York", 2026, 3, 8],
      ["America/New_York", 2026, 11, 1],
      ["Australia/Lord_Howe", 2026, 4, 5],
      ["Australia/Lord_Howe", 2026, 10, 4],
    ] as const) {
      for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 15, 30, 45]) {
          const w = wall(year, month, day, hour, minute);
          const r = resolve(w, zone);
          if (r.kind === "unique" || r.kind === "ambiguous") {
            expect(wallAt(r.instant, zone), `${zone} ${hour}:${minute}`).toEqual(w);
          } else {
            expect(r.kind, `${zone} ${hour}:${minute}`).toBe("gap");
          }
        }
      }
    }
  });

  it("a gap is found on the day it happens and nowhere else", () => {
    // The day before and the day after a transition have twenty-four ordinary hours. A
    // resolver that reported a gap on an ordinary day would be refusing real times.
    for (const day of [7, 9]) {
      for (let hour = 0; hour < 24; hour++) {
        const r = resolve(wall(2026, 3, day, hour, 30), "America/New_York");
        expect(r.kind, `March ${day} ${hour}:30`).toBe("unique");
      }
    }
  });
});

describe("zones it does not know", () => {
  it("says so rather than falling back to local time", () => {
    // Falling back to local would answer a question about Tokyo with an answer about here,
    // and the number would look completely reasonable.
    for (const zone of ["Nowhere/Nothing", "Mars/Olympus", "Europe/Nowhere"]) {
      expect(resolve(wall(2026, 6, 15, 12), zone).kind, zone).toBe("unknown-zone");
    }
  });

  it("an abbreviation is refused even though Intl accepts it", () => {
    // This is the finding that changed the design. Intl says yes to EST and maps it to
    // America/Panama, which has no daylight saving: it agrees with New York for four months
    // a year and is an hour out for the other eight. A wrong answer that is right often
    // enough for nobody to catch it is the worst kind this app can produce.
    for (const zone of ["EST", "IST", "CST", "PST", "GMT", "est", " EST "]) {
      expect(resolve(wall(2026, 6, 15, 12), zone).kind, zone).toBe("abbreviation");
    }
  });

  it("a refused abbreviation says what it might have meant", () => {
    // "That is not a zone" is unhelpful for somebody who typed EST and had every reason to
    // think it was one.
    const r = resolve(wall(2026, 6, 15, 12), "EST");
    expect(r.kind).toBe("abbreviation");
    if (r.kind === "abbreviation") expect(r.couldMean).toMatch(/New York.*Panama/);
    expect(suggestionFor("IST")).toMatch(/Kolkata.*Dublin.*Jerusalem/);
    expect(suggestionFor("cst")).toMatch(/Chicago.*Shanghai.*Havana/);
  });

  it("an abbreviation with nothing useful to add still refuses", () => {
    const r = resolve(wall(2026, 6, 15, 12), "XYZ");
    expect(r.kind).toBe("abbreviation");
    if (r.kind === "abbreviation") expect(r.couldMean).toBeNull();
  });

  it("UTC is the one short name that is allowed, because it is not ambiguous", () => {
    const r = resolve(wall(2026, 6, 15, 12), "UTC");
    expect(r.kind).toBe("unique");
    if (r.kind === "unique") expect(new Date(r.instant).toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("never throws, whatever it is handed", () => {
    fc.assert(
      fc.property(fc.string(), (zone) => {
        expect(() => resolve(wall(2026, 6, 15, 12), zone)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it("wallAt is null for an unknown zone rather than a shape full of NaN", () => {
    expect(wallAt(Date.UTC(2026, 5, 15), "Nowhere/Nothing")).toBeNull();
    expect(wallAt(Date.UTC(2026, 5, 15), "EST")).toBeNull();
  });

  it("the gap message names the transition, not the time that was asked about", () => {
    // The first version calculated this from the two offsets and reported the New York gap
    // as starting at 00:30, because it conflated the requested time with the transition
    // time. It searches for the transition now, so it cannot make that mistake.
    for (const [minute, from, to] of [[30, "02:00", "03:00"], [1, "02:00", "03:00"], [59, "02:00", "03:00"]] as const) {
      const r = resolve(wall(2026, 3, 8, 2, minute), "America/New_York");
      expect(r.kind).toBe("gap");
      if (r.kind === "gap") {
        expect(r.skippedFrom, `02:${minute}`).toBe(from);
        expect(r.skippedTo, `02:${minute}`).toBe(to);
      }
    }
  });

  it("a half-hour gap is described as half an hour", () => {
    const r = resolve(wall(2026, 10, 4, 2, 15), "Australia/Lord_Howe");
    expect(r.kind).toBe("gap");
    if (r.kind === "gap") {
      expect(r.skippedFrom).toBe("02:00");
      expect(r.skippedTo).toBe("02:30");
    }
  });
});

describe("the engine's own quirks, pinned", () => {
  it("midnight reported as 24 is read as hour 0", () => {
    // This engine reports "00", so removing the guard inside wallAt passes every other test
    // here. The rule is a function so it can be handed the input the engine never produces,
    // which turns an unverifiable line into a tested one.
    expect(normaliseHour("24")).toBe(0);
    expect(normaliseHour(24)).toBe(0);
    expect(normaliseHour("00")).toBe(0);
    expect(normaliseHour("13")).toBe(13);
    expect(normaliseHour("23")).toBe(23);
  });

  it("an hour that is not a number is 0 rather than NaN", () => {
    // NaN would propagate into Date.UTC and produce an Invalid Date, and every reading in
    // the document would then be blank with nothing saying why.
    for (const bad of ["", "  ", "noon", NaN]) expect(normaliseHour(bad)).toBe(0);
  });

  it("and midnight really does resolve, end to end", () => {
    const r = resolve(wall(2026, 6, 15, 0, 0), "Europe/London");
    expect(r.kind).toBe("unique");
    if (r.kind === "unique") expect(wallAt(r.instant, "Europe/London")?.hour).toBe(0);
  });

  it("a zone with a fractional offset resolves exactly", () => {
    // Kathmandu is UTC+05:45. A resolver that assumed whole hours, or even half hours,
    // would be 15 or 45 minutes out here and nowhere else.
    const r = resolve(wall(2026, 6, 15, 12, 0), "Asia/Kathmandu");
    expect(r.kind).toBe("unique");
    if (r.kind === "unique") {
      expect(new Date(r.instant).toISOString()).toBe("2026-06-15T06:15:00.000Z");
    }
  });

  it("the far ends of the world resolve", () => {
    // UTC+14 and UTC-11 are past the point where a naive day-boundary assumption holds.
    expect(resolve(wall(2026, 6, 15, 12), "Pacific/Kiritimati").kind).toBe("unique");
    expect(resolve(wall(2026, 6, 15, 12), "Pacific/Midway").kind).toBe("unique");
  });
});
