import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import { run } from "./evaluate";
import { format } from "../format";

/** A document in, the margin out. One string per line, exactly what a reader would see. */
const margin = (doc: string): string[] => run(doc).rows.map((r) => format(r.value));
const one = (line: string): string => margin(line)[0] ?? "";

group("the things a notepad is for", () => {
  test("plain arithmetic", () => {
    expect(one("1 + 2 * 3")).toBe("7");
    expect(one("(1 + 2) * 3")).toBe("9");
  });

  test("units, in the unit that was written first", () => {
    expect(one("3 m + 40 cm")).toBe("3.4 m");
    expect(one("2 kg + 500 g")).toBe("2.5 kg");
  });

  test("conversion", () => {
    expect(one("3 m in cm")).toBe("300 cm");
    expect(one("1 mi in km")).toBe("1.609344 km");
    expect(one("90 deg in rad")).toBe("1.570796327 rad");
  });

  test("rates, in every form somebody writes one", () => {
    expect(one("100 km/h")).toBe("100 km/h");
    expect(one("60 km/h * 3 h")).toBe("180 km");
    expect(one("100 km / 2 h")).toBe("50 km/h");
    // Dividing by a rate, which is the input that decided how a unit suffix binds.
    expect(one("240 km / 90 km/h")).toBe("2.666666667 h");
  });

  test("what grouping the unit suffix costs, written down rather than hidden", () => {
    // `2 m` is one operand now, so this is one over two metres rather than half a metre.
    // Accepted: dividing by a rate is written constantly, and everybody writes half a metre
    // as `0.5 m`. The answer is also visibly a rate rather than a plausible length, so it
    // announces that it was read differently.
    expect(one("1/2 m")).toBe("0.5 1/m");
    expect(one("0.5 m")).toBe("0.5 m");
  });

  test("money totals, which is the operation people actually want", () => {
    expect(one("$1,850 + $150")).toBe("$2,000");
  });

  test("a percentage of a thing", () => {
    expect(one("120 + 10%")).toBe("132");
    expect(one("20% * 250")).toBe("50");
  });

  test("names carry forward", () => {
    expect(margin("rate = 60 km/h\nrate * 3 h")).toEqual(["60 km/h", "180 km"]);
  });

  test("dates, and the weekday comes free", () => {
    expect(one("2026-09-10 + 3 weeks")).toBe("Thu 1 Oct 2026");
    expect(one("2026-01-31 + 1 month")).toBe("Sat 28 Feb 2026");
    expect(one("2026-12-25 - 2026-09-10")).toBe("106 day");
  });
});

group("prose is silent, and that is what makes the rest readable", () => {
  test("a sentence produces nothing", () => {
    expect(margin("Milk and eggs\n1 + 1")).toEqual(["", "2"]);
  });

  test("a blank line produces nothing", () => {
    expect(margin("\n\n")).toEqual(["", "", ""]);
  });

  test("but a broken sum is not silent", () => {
    // The distinction the whole prose rule exists to draw: `Milk and eggs` is a note and
    // `3 kg +` is a mistake, and treating either as the other makes the notepad useless.
    expect(one("3 kg +")).toMatch(/ends before the expression does/);
  });
});

group("errors do not produce numbers, and do not spread", () => {
  test("a mismatch says which dimensions, and shows no figure", () => {
    const said = one("3 m + 2 kg");
    expect(said).toBe("length and mass do not add");
    expect(said).not.toMatch(/\d/);
  });

  test("a failed line leaves the lines below it alone", () => {
    expect(margin("1 + 1\n3 m + 2 kg\n2 + 2")).toEqual(["2", "length and mass do not add", "4"]);
  });

  test("a name holding a failure poisons only what mentions it", () => {
    const out = margin(["a = 3 m + 2 kg", "b = 10", "a + 1", "b + 1"].join("\n"));
    expect(out[0]).toBe("length and mass do not add");
    expect(out[1]).toBe("10");
    expect(out[2]).toBe("depends on line 1, which failed");
    expect(out[3]).toBe("11");
  });

  test("the blame names the line, not the reason, because the reason is not about this line", () => {
    expect(margin("x = 1/0\nx + 5")[1]).toBe("depends on line 1, which failed");
  });

  test("nothing ever falls back to zero", () => {
    // The failure this program is built to make impossible. Every one of these is a line
    // that could plausibly have been given a number by a less careful design.
    for (const line of ["1/0", "3 m + 2 kg", "$5 + €5", "widgets * 3", "2026-02-30", "3 m in kg"]) {
      const said = one(line);
      expect(said, line).not.toBe("0");
      expect(said.length, line).toBeGreaterThan(0);
    }
  });

  test("inserting a broken line changes nothing about the lines that do not reference it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (at) => {
        const good = ["1 + 1", "2 + 2", "3 + 3"];
        const withBreak = [...good.slice(0, at), "$$$ &&&", ...good.slice(at)];
        const out = margin(withBreak.join("\n")).filter((_, i) => i !== at);
        expect(out).toEqual(["2", "4", "6"]);
      }),
    );
  });
});

group("a name means one thing, and a variable wins", () => {
  test("a unit word with nothing bound is that unit", () => {
    expect(one("3 m")).toBe("3 m");
  });

  test("a variable shadows a unit, because somebody who wrote it meant it", () => {
    expect(margin("m = 5\n3 m")).toEqual(["5", "15"]);
  });

  test("an undefined name is named, not treated as zero", () => {
    expect(one("widgets * 3")).toBe("widgets is not defined");
  });

  test("there are no forward references, because a notepad is read downward", () => {
    expect(margin("x = y + 1\ny = 2")).toEqual(["y is not defined", "2"]);
  });

  test("months and years are names, not units", () => {
    expect(one("3 months")).toBe("3 months");
    expect(one("2 years")).toBe("2 years");
    expect(one("3 months + 2 days")).toMatch(/not a fixed number of days/);
  });

  test("a bit is refused where it is used, with the same message as everywhere else", () => {
    expect(one("100 Mb")).toMatch(/ambiguous/);
  });
});

group("total, whose window has to be visible to be checkable", () => {
  test("it adds the contiguous run directly above", () => {
    expect(margin("1\n2\n3\ntotal")).toEqual(["1", "2", "3", "6"]);
  });

  test("a blank line ends the run", () => {
    expect(margin("1\n2\n\n10\n20\ntotal")).toEqual(["1", "2", "", "10", "20", "30"]);
  });

  test("another total ends the run, so totals never double-count", () => {
    const out = margin(["1", "2", "total", "10", "20", "total"].join("\n"));
    expect(out).toEqual(["1", "2", "3", "10", "20", "30"]);
  });

  test("the window is reported, because an aggregate nobody can check is a number to distrust", () => {
    const sheet = run("1\n2\n3\ntotal");
    expect(sheet.windows.get(4)).toEqual([1, 2, 3]);
  });

  test("it totals money and units too, and refuses to mix them", () => {
    expect(margin("$10\n$20\ntotal")).toEqual(["$10", "$20", "$30"]);
    expect(margin("3 m\n2 kg\ntotal")[2]).toBe("length and mass do not add");
  });

  test("nothing above it says so rather than showing zero", () => {
    expect(one("total")).toBe("nothing above this to add up");
  });

  test("a broken line in the window is skipped, since it already says so in its own margin", () => {
    expect(margin("10\n3 m + 2 kg\n20\ntotal")[3]).toBe("30");
  });
});

group("totality", () => {
  test("any document at all evaluates without throwing", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 8 }), (lines) => {
        expect(() => run(lines.join("\n"))).not.toThrow();
      }),
    );
  });

  test("every line produces exactly one row, always", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 8 }), (lines) => {
        expect(run(lines.join("\n")).rows).toHaveLength(lines.length || 1);
      }),
    );
  });

  test("every value formats to a string, and never to undefined or NaN", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 6 }), (lines) => {
        for (const said of margin(lines.join("\n"))) {
          expect(typeof said).toBe("string");
          expect(said).not.toMatch(/NaN|undefined|\[object/);
        }
      }),
    );
  });

  test("evaluation is deterministic", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 6 }), (lines) => {
        const doc = lines.join("\n");
        expect(margin(doc)).toEqual(margin(doc));
      }),
    );
  });
});
