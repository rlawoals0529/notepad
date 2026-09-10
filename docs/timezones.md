# Timezones

The single most likely thing in this app to be quietly wrong, so it was measured rather than
reasoned about.

## The obvious algorithm returns times that do not exist

Two passes: build an instant as if the wall fields were UTC, ask the zone its offset at that
instant, subtract it. Run against this engine's own `Intl`:

| Asked for | Naive answer | Truth |
| --- | --- | --- |
| `2026-03-08 02:30` New York | an instant reading back as **03:30** | never happened, clocks skip 02:00 to 03:00 |
| `2026-10-04 02:15` Lord Howe | an instant reading back as **01:45** | never happened, a 30-minute skip |
| `2026-11-01 01:30` New York | one of two valid instants | happens **twice**, EDT and EST |

Two answers silently different from what was asked, and one that silently picks a side.

## Candidate resolution

Probe the offset a day either side, build the at-most-two candidate instants that implies,
and **keep only those that format back to exactly the wall fields requested**. Then count:
zero is a gap, two is ambiguous, one is the answer.

Lord Howe's half-hour shift needed no special case. Nothing in the resolver knows how large a
transition is, which is the point of checking the answer rather than computing it.

This is a faithful subset of `Temporal.ZonedDateTime.from` with `disambiguation: "reject"`,
shaped so it can become that one call when `Temporal` is baseline. The polyfill is about
200 KB, which is larger than the rest of this app.

## Abbreviations are refused, and this is the finding that changed the design

`Intl` accepts them and maps them silently, sometimes to a zone the writer did not mean:

| Typed | `Intl` gives | |
| --- | --- | --- |
| `EST` | `America/Panama` | no daylight saving at all |
| `IST` | `Asia/Calcutta` | also Irish and Israel Standard Time |
| `CST` | `America/Chicago` | also China and Cuba Standard Time |
| `GMT` | `UTC` | not the same as London in summer |

**`EST` is the one that matters.** Somebody writing it almost certainly means New York.
Panama agrees with New York for four months a year and is an hour out for the other eight, so
it is a wrong answer that looks right, arrives without warning, and is correct often enough
that nobody catches it.

So a zone must be an IANA name, `Region/City`, or `UTC`. `Intl` cannot be trusted to refuse
these, which makes this the one guard that cannot be delegated to the platform. The refusal
names what the abbreviation might have meant, because "that is not a zone" is unhelpful to
someone who typed `EST` and had every reason to think it was one.

## Mutations

Each of these must turn a named test red.

| Change | Turns red |
| --- | --- |
| Candidates are not checked against the requested fields | 7 tests, including the soundness property |
| Only one candidate is built, which is the naive algorithm | 2 |
| Two survivors are reported as `unique` | `reports both instants when the clocks went back` |
| The abbreviation guard is removed | 3 |
| `offsetAt` subtracts the unfloored instant | 3 |
| `normaliseHour` stops mapping 24 to 0 | `midnight reported as 24 is read as hour 0` |

### A guard that could not be mutation-tested, and what was done about it

The last one is the interesting entry. This engine reports midnight as `"00"`, so the
`hour === 24` check inside the formatter reader is unreachable here: removing it passed every
test. The check still matters, because older engines have returned `"24"` and the consequence
is every midnight being a day out.

Rather than carry an unverifiable line, the rule was extracted into `normaliseHour` and
handed the input the engine never produces. The guard is now tested even though the condition
does not arise locally, which is the general answer to a guard you cannot reach: **test the
rule, not the path.**

## Two bugs found while building it

**`offsetAt` was returning offsets that carried seconds.** The wall fields are
minute-precision, so subtracting an instant with a non-zero seconds component left the
seconds in the offset. Two offsets inside the same zone period then compared unequal, the
binary search that finds a transition converged on nothing, and the New York gap was reported
as starting at 01:14.

**The gap description was calculated rather than found.** The first version derived the
skipped range from the two offsets and the requested time, which conflated the time asked
about with the time the clocks moved. It reports the transition found by search now, so it
cannot make that mistake.
