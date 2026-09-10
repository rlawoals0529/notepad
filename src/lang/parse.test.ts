import { describe as group, expect, test } from "vitest";
import fc from "fast-check";
import { parse, type Line, type Node } from "./parse";

/** The tree as a bracketed string, so a precedence assertion reads as one line. */
function shape(n: Node): string {
  switch (n.t) {
    case "num": return String(n.value);
    case "qty": return `${n.value}[${n.units.map((u) => (u.power === 1 ? u.name : `${u.name}^${u.power}`)).join(" ")}]`;
    case "pct": return `${n.value}%`;
    case "money": return `${n.tag}(${shape(n.of)})`;
    case "date": return `${n.year}-${String(n.month).padStart(2, "0")}-${String(n.day).padStart(2, "0")}`;
    case "name": return n.name;
    case "bin": return `(${shape(n.left)} ${n.op} ${shape(n.right)})`;
    case "neg": return `-${shape(n.of)}`;
    case "convert": return `(${shape(n.of)} in ${shape(n.to)})`;
    case "total": return "total";
    case "bad": return `!${n.message}`;
  }
}

const of = (line: Line): string =>
  line.t === "expression" ? shape(line.node)
  : line.t === "assignment" ? `${line.name} = ${shape(line.node)}`
  : line.t;

group("precedence", () => {
  test("multiplication binds tighter than addition", () => {
    expect(of(parse("1 + 2 * 3"))).toBe("(1 + (2 * 3))");
  });

  test("power binds tightest and is right associative", () => {
    expect(of(parse("2 ^ 3 ^ 2"))).toBe("(2 ^ (3 ^ 2))");
    expect(of(parse("2 * 3 ^ 2"))).toBe("(2 * (3 ^ 2))");
  });

  test("unary minus is looser than power, so -2^2 is minus four", () => {
    // Everywhere else in the world this is -4, and a notepad that disagreed would be wrong
    // in a way nobody would think to check.
    expect(of(parse("-2 ^ 2"))).toBe("-(2 ^ 2)");
  });

  test("brackets override, and a wrapped expression is the same expression", () => {
    expect(of(parse("(1 + 2) * 3"))).toBe("((1 + 2) * 3)");
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 999 }), (a, b) => {
        expect(of(parse(`(${a} + ${b})`))).toBe(of(parse(`${a} + ${b}`)));
      }),
    );
  });

  test("addition is left associative, so subtraction chains correctly", () => {
    expect(of(parse("10 - 3 - 2"))).toBe("((10 - 3) - 2)");
  });
});

group("a number and the units written after it are one operand", () => {
  test("a number and a unit", () => {
    expect(of(parse("3 m"))).toBe("3[m]");
  });

  test("a rate is one operand, which is the whole reason this node exists", () => {
    expect(of(parse("100 km/h"))).toBe("100[km h^-1]");
  });

  test("and so a division by a rate groups correctly", () => {
    // Left-associative juxtaposition read this as `((240 km / 90) * km) / h`, which is
    // km²/h. It was in the example document on the first screen, which is how it was found.
    expect(of(parse("240 km / 90 km/h"))).toBe("(240[m] / 90[km h^-1])".replace("[m]", "[km]"));
  });

  test("a slash only continues the unit when a unit word follows it directly", () => {
    // This is what tells `100 km/h` apart from `240 km / 90 ...`: a number after the slash
    // ends the operand, a unit word continues it.
    expect(of(parse("100 km / 2"))).toBe("(100[km] / 2)");
  });

  test("a unit with an integer power", () => {
    expect(of(parse("2 m^2"))).toBe("2[m^2]");
  });

  test("a word that is not a unit ends the suffix, so it can be reported by name", () => {
    // `3 apples` has to reach the evaluator as a name, or the message would be about units
    // rather than about the undefined thing the reader actually wrote.
    expect(of(parse("3 apples"))).toBe("(3 * apples)");
  });

  test("1/2 m now reads as one per two metres, and that is the trade", () => {
    // The cost of grouping. `a / b c` was `(a/b) * c`, which made this half a metre; now
    // `2 m` is one operand, so it is one over two metres. Accepted because the input it
    // fixes -- dividing by a rate -- is one people write constantly, and this one is
    // written as `0.5 m` by everybody.
    expect(of(parse("1/2 m"))).toBe("(1 / 2[m])");
  });
});

group("the one genuine ambiguity: in", () => {
  test("after a bare number, in is inches", () => {
    expect(of(parse("6 in"))).toBe("(6 * in)");
  });

  test("after something that already has a unit, in is the keyword", () => {
    expect(of(parse("3 m in cm"))).toBe("(3[m] in cm)");
  });

  test("both, in that order, on one line", () => {
    expect(of(parse("6 in in cm"))).toBe("((6 * in) in cm)");
  });

  test("a sum of inches stays a sum", () => {
    expect(of(parse("6 in + 2 in"))).toBe("((6 * in) + (2 * in))");
  });

  test("to is never a unit, so it needs none of that", () => {
    expect(of(parse("3 m to cm"))).toBe("(3[m] in cm)");
    expect(of(parse("6 to"))).toBe("!nothing to convert into");
  });

  test("conversion is loosest, so it converts the whole sum", () => {
    expect(of(parse("1 m + 20 cm in mm"))).toBe("((1[m] + 20[cm]) in mm)");
  });
});

group("the other kinds of line", () => {
  test("an assignment", () => {
    expect(of(parse("rate = 3 m"))).toBe("rate = 3[m]");
  });

  test("money is a prefix that tags what follows", () => {
    expect(of(parse("$1,850"))).toBe("$(1850)");
    expect(of(parse("$(x + y)"))).toBe("$((x + y))");
  });

  test("a percent binds to its own number and nothing else", () => {
    expect(of(parse("120 + 10%"))).toBe("(120 + 10%)");
  });

  test("a date is one value, not a subtraction", () => {
    expect(of(parse("2026-09-10"))).toBe("2026-09-10");
  });

  test("a blank line is blank", () => {
    expect(parse("").t).toBe("blank");
    expect(parse("   ").t).toBe("blank");
  });

  test("prose is silent, because a notepad has sentences in it", () => {
    for (const line of ["Milk and eggs", "call the bank", "ideas for later"]) {
      expect(parse(line).t, line).toBe("prose");
    }
  });

  test("a line with a number in it is not prose, even if it reads like a sentence", () => {
    // The accepted misjudgement, written down rather than hidden: this one is wrong, and it
    // is wrong cosmetically rather than numerically, which is the trade.
    expect(parse("Call Bob at 5").t).toBe("expression");
  });

  test("total is a keyword, not a name", () => {
    expect(of(parse("total"))).toBe("total");
    expect(of(parse("sum"))).toBe("total");
  });
});

group("mistakes are nodes, never exceptions", () => {
  test("an unclosed bracket says so", () => {
    expect(of(parse("(1 + 2"))).toMatch(/opened and never closed/);
  });

  test("a trailing operator says so", () => {
    expect(of(parse("3 kg +"))).toMatch(/ends before the expression does/);
  });

  test("a stray character is named and quoted back", () => {
    expect(of(parse("3 § 4"))).toMatch(/"§"/);
  });

  test("a percent with nothing in front of it", () => {
    expect(of(parse("% 5"))).toMatch(/needs a number before it/);
  });

  test("any string at all parses without throwing", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parse(s)).not.toThrow();
      }),
    );
  });

  test("and always produces one of the four kinds of line", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(["blank", "prose", "expression", "assignment"]).toContain(parse(s).t);
      }),
    );
  });
});
