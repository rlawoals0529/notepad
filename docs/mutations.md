# Mutations

Each of these must turn a named test red. A suite nobody has seen fail is not evidence, and
the two at the bottom are here because the properties do **not** catch them, which is the
sharpest thing in this design.

Run one by making the edit, running `npm test`, and confirming the named test fails.

| Mutation | Should fail |
| --- | --- |
| `units.ts`: pound factor `0.45359237` → `0.4536` | "the international pound is exactly 0.45359237 kg" |
| `units.ts`: inch factor `0.0254` → `0.025` | "the international inch is exactly 0.0254 m" |
| `units.ts`: `kB` factor `1000` → `1024` | "kB is 1000 and KiB is 1024, and they are different units" |
| `units.ts`: delete the `REFUSED` map | "the ambiguous spellings say what to write instead" |
| `dimension.ts`: make `same` ignore the mass exponent | "length and mass are not compatible" |
| `dimension.ts`: swap `add` and `sub` | "dividing subtracts, which is where km/h comes from" |
| `arith.ts`: allow `+` when one side is dimensionless | "a plain number does not add to a quantity" |
| `arith.ts`: return `0` instead of an error for a mismatch | "nothing ever falls back to zero" |
| `arith.ts`: let `dividedBy` return Infinity | "dividing by zero is said, not returned as Infinity" |
| `arith.ts`: give two currencies a rate of 1 | "two currencies do not add" |
| `parse.ts`: swap the binding power of `*` and `/` | "addition is left associative" |
| `parse.ts`: make unary minus bind tighter than `^` | "unary minus is looser than power, so -2^2 is minus four" |
| `parse.ts`: continue a unit suffix past a number | "a slash only continues the unit when a unit word follows it directly" |
| `parse.ts`: make `in` always the keyword | "after a bare number, in is inches" |
| `evaluate.ts`: resolve units before variables | "a variable shadows a unit" |
| `evaluate.ts`: let `total` include a previous total | "another total ends the run, so totals never double-count" |
| `evaluate.ts`: make an unresolved name return zero | "an undefined name is named, not treated as zero" |
| `evaluate.ts`: evaluate in two passes | "there are no forward references" |
| `civil.ts`: make `addMonths` carry the original day | "31 January plus a month is the end of February" |
| `civil.ts`: drop the century rule from `isLeap` | "the rule" |
| `format.ts`: render an error's value instead of its message | "an error renders as words and never as a figure" |
| `format.ts`: pad money to one decimal | "money shows no decimals or exactly two, never one" |
| `tokenise.ts`: make the `**` token carry the text `"^"` | "a token is always findable at its own offset" |
| `app.css`: `white-space: pre` → `pre-wrap` | e2e "a very long line does not wrap" |

## The two the properties cannot catch

**A wrong constant is self-consistent.** Change the pound to `0.4536` and every round-trip
property still passes, because `x in lb in kg in lb` returns to `x` whatever the factor is.
Only a number pinned against the standard that defines it catches this. That is why
`units.test.ts` writes the constants out with their citations instead of only checking that
conversion is reversible.

**One valid instant is still a valid instant.** Delete the ambiguity check in the timezone
resolver and return the first candidate, and the soundness property still passes: what it
asserts is that the answer formats back to the requested wall fields, and the earlier of the
two ambiguous instants does. Only the pinned New York case catches it.

## A property is only as good as its alphabet

The token-coverage property found the `**` bug once, in one run out of roughly fifty, and
then could not be reproduced. Two hundred thousand targeted runs found nothing, because they
were generated over arbitrary code units and two adjacent asterisks almost never appear
there. Run over the characters this language actually uses, the same property finds it in a
handful of cases.

So the property now runs against both alphabets, and the counterexample is pinned as an
ordinary test beside it. A property that fails one run in fifty does not read as a bug. It
reads as flakiness, and flakiness gets muted.
