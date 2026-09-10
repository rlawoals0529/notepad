import { expect, test } from "vitest";
import { run } from "./lang/evaluate";
import { format } from "./format";
import { EXAMPLE } from "./ui/example";

test("the document you open with actually works", () => {
  // A first screen that shows an error is a first impression that says the tool is broken,
  // so this is pinned line by line rather than checked for absence of failure.
  const said = run(EXAMPLE).rows.map((r) => `${r.text.padEnd(22)}${format(r.value)}`);
  expect(said).toEqual([
    "Trip on Saturday      ",
    "                      ",
    "distance = 240 km     240 km",
    "distance / 90 km/h    2.666666667 h",
    "                      ",
    "petrol = $62.40       $62.40",
    "tolls  = $9.80        $9.80",
    "food   = $35          $35",
    "total                 $107.20",
    "                      ",
    "leaving = 2026-09-12  Sat 12 Sep 2026",
    "leaving + 3 weeks     Sat 3 Oct 2026",
  ]);
});
