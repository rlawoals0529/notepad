/**
 * What is in the document when you open it.
 *
 * Chosen to show the four things that are not obvious, in the order they are worth
 * discovering: that units carry through arithmetic, that money totals without any rate
 * being involved, that a date moves by whole days without a timezone anywhere near it, and
 * that prose is silent so a document can be mostly words.
 *
 * Deliberately not a feature tour. A first screen that demonstrates everything is a first
 * screen nobody reads.
 */
export const EXAMPLE = [
  "Trip on Saturday",
  "",
  "distance = 240 km",
  "distance / 90 km/h",
  "",
  "petrol = $62.40",
  "tolls  = $9.80",
  "food   = $35",
  "total",
  "",
  "leaving = 2026-09-12",
  "leaving + 3 weeks",
].join("\n");
