/**
 * Turning a wall-clock time in a named zone into an instant, or saying why there isn't one.
 *
 * This is the piece most likely to be quietly wrong, so it was measured rather than reasoned
 * about. **The obvious algorithm returns times that do not exist, and says nothing.**
 *
 * The obvious algorithm is two passes: build an instant as if the wall fields were UTC, ask
 * the zone what its offset is at that instant, subtract it. Run against Chromium's own
 * `Intl` on three real cases:
 *
 *   America/New_York   2026-03-08 02:30   returns an instant reading back as 03:30
 *   Australia/Lord_Howe 2026-10-04 02:15  returns an instant reading back as 01:45
 *   America/New_York   2026-11-01 01:30   returns one of two valid instants, unannounced
 *
 * The first two do not exist: those clocks skip 02:00 to 03:00, and Lord Howe skips by only
 * thirty minutes. The third happens twice. So the naive version gives two answers that are
 * silently different from what was asked and one that silently picks a side, and a notepad
 * whose worst output is a plausible wrong number cannot do that.
 *
 * **Candidate resolution instead.** Probe the offset on both sides of the naive instant,
 * build the at-most-two candidates that implies, and keep only those that format back to
 * exactly the wall fields requested. Then count what survived: zero is a gap, two is
 * ambiguous, one is the answer. Lord Howe's half-hour shift needs no special case, because
 * nothing here knows or cares how large a transition is.
 *
 * This is a faithful subset of `Temporal.ZonedDateTime.from` with
 * `disambiguation: "reject"`, and it is shaped so it can become that one call when
 * `Temporal` is baseline. The polyfill is about 200 KB, which is more than the whole of the
 * rest of this app.
 */

/**
 * Zone abbreviations are refused, and this is not pedantry.
 *
 * `Intl` accepts them and maps them silently, sometimes to a zone the writer did not mean.
 * Measured on this engine:
 *
 *   EST  ->  America/Panama          which has no daylight saving at all
 *   IST  ->  Asia/Calcutta           and IST is also Irish and Israel Standard Time
 *   CST  ->  America/Chicago         and CST is also China and Cuba Standard Time
 *   PST  ->  America/Los_Angeles
 *
 * `EST` is the one that shows why this matters. Somebody writing it almost certainly means
 * New York, and Panama agrees with New York for four months of the year and is an hour out
 * for the other eight. That is a wrong answer that looks right, arrives without warning,
 * and is correct often enough that nobody catches it.
 *
 * So a zone has to be an IANA name: `Region/City`, or `UTC`. Anything shorter is refused
 * with the ambiguity named, which is a worse experience and a correct one.
 */
const looksLikeIana = (zone: string) => zone === "UTC" || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone);

/**
 * What a refused abbreviation could have meant, for the message.
 *
 * Only the ones where the ambiguity is real and the naive guess is wrong. A list of every
 * abbreviation would be the stale regex database this app is trying not to have.
 */
const AMBIGUOUS: Record<string, string> = {
  EST: "New York, or Panama, which has no daylight saving",
  EDT: "New York",
  CST: "Chicago, Shanghai, or Havana",
  CDT: "Chicago",
  PST: "Los Angeles",
  PDT: "Los Angeles",
  MST: "Denver, or Phoenix, which has no daylight saving",
  IST: "Kolkata, Dublin, or Jerusalem",
  BST: "London, or Bougainville",
  CET: "Paris, Berlin, or Madrid",
  AEST: "Sydney, or Brisbane, which has no daylight saving",
  GMT: "London, which is not the same as UTC in summer",
};

/** What to say instead of an abbreviation, or null when there is nothing helpful to add. */
export function suggestionFor(zone: string): string | null {
  const key = zone.trim().toUpperCase();
  return AMBIGUOUS[key] ?? null;
}

/** The wall-clock fields somebody wrote down. No zone, no instant. */
export interface Wall {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export type Resolved =
  /** Exactly one instant reads back as these fields. */
  | { readonly kind: "unique"; readonly instant: number }
  /**
   * Two do, because the clocks went back. The earlier is offered and the other is named,
   * because two numbers in one margin cell is unreadable and an unmarked one is a lie.
   */
  | { readonly kind: "ambiguous"; readonly instant: number; readonly other: number }
  /** None do. The clocks skipped over this time and it never happened. */
  | { readonly kind: "gap"; readonly skippedFrom: string; readonly skippedTo: string }
  /** The zone is not one this engine knows. */
  | { readonly kind: "unknown-zone" }
  /**
   * The zone is an abbreviation, which is refused however well the engine understands it.
   * See the note on `looksLikeIana`: `EST` resolves to Panama here, which agrees with New
   * York for four months a year and is an hour out for the other eight.
   */
  | { readonly kind: "abbreviation"; readonly couldMean: string | null };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A formatter per zone, built once.
 *
 * `Intl.DateTimeFormat` is expensive to construct and this is called for every line of a
 * document on every keystroke. Without the cache, typing in a document with a few zoned
 * lines is visibly slow.
 */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  // Checked before the engine is asked, because the engine says yes to things it should
  // not. This is the only guard that cannot be delegated to Intl.
  if (!looksLikeIana(zone)) return null;
  if (formatters.has(zone)) return formatters.get(zone) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    // An unknown zone throws on construction. Cached as null so a document full of a
    // misspelled zone does not retry the throw on every keystroke.
    f = null;
  }
  formatters.set(zone, f);
  return f;
}

/**
 * The hour a formatter reported, as a number 0 to 23.
 *
 * Exported, and that is the point. Older engines have returned "24" for midnight instead of
 * "00", and the guard against it cannot be reached on an engine that does not do it: a
 * mutation removing the check passes every test here, because V8 reports "00". Rather than
 * carry an unverifiable line, the rule is a function and the function is tested with 24 as
 * its input. The guard is then verified even though the condition never arises locally.
 *
 * A one-line defence against every midnight being a day out is worth keeping for what
 * happens when it fires, not for whether it fires today.
 */
export function normaliseHour(raw: string | number): number {
  const hour = Number(raw);
  if (!Number.isFinite(hour)) return 0;
  return hour === 24 ? 0 : hour;
}

/**
 * What an instant reads as, in a zone.
 *
 * Numeric fields inverted out of `formatToParts`, not parsed out of a formatted string. A
 * string is locale-dependent and engine-dependent in ways that are not worth discovering in
 * production; the parts are pinned to `2-digit` above so they are always the same shape.
 *
 * `timeZoneName` is deliberately never asked for. Its rendering varies by locale and by
 * engine, and code that parses it is code that breaks on a browser update.
 */
export function wallAt(instant: number, zone: string): Wall | null {
  const f = formatterFor(zone);
  if (!f) return null;
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(instant))) parts[p.type] = p.value;

  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: normaliseHour(parts["hour"] ?? ""),
    minute: Number(parts["minute"]),
  };
}

const sameWall = (a: Wall | null, b: Wall) =>
  a !== null &&
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute;

/**
 * The offset a zone is at, at a given instant, in whole minutes of milliseconds.
 *
 * The instant is floored to the minute before subtracting, and that is not tidiness. The
 * wall fields above are minute-precision, so subtracting an instant that carries seconds
 * leaves the seconds in the answer: the offset for 07:00:00.500Z came back as five hours
 * and 500 milliseconds. Two offsets in the same zone period then compared unequal, which
 * made the binary search below converge on nothing and report the New York gap as starting
 * at 01:14.
 */
function offsetAt(instant: number, zone: string): number | null {
  const w = wallAt(instant, zone);
  if (!w) return null;
  const flooredToMinute = Math.floor(instant / MINUTE) * MINUTE;
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - flooredToMinute;
}

/**
 * The instant a zone's offset changes, found rather than calculated.
 *
 * A binary search over a two-day window, to the second. Calculating it from the two offsets
 * is what the first version of this did and it was wrong: it reported the New York gap as
 * starting at 00:30 rather than 02:00, because the arithmetic conflated the requested time
 * with the transition time. The search cannot make that mistake, because it asks the zone.
 */
function findTransition(
  lo: number,
  hi: number,
  zone: string,
): { at: number; before: number; after: number } | null {
  const offsetLo = offsetAt(lo, zone);
  const offsetHi = offsetAt(hi, zone);
  if (offsetLo === null || offsetHi === null || offsetLo === offsetHi) return null;

  while (hi - lo > MINUTE) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, zone) === offsetLo) lo = mid;
    else hi = mid;
  }
  // The two offsets come from the ends of the narrowed window rather than from probing
  // either side of the answer. Those two instants are known to be on opposite sides of the
  // transition, which is exactly what the search established; probing near the boundary
  // risks landing on the same side twice.
  return { at: hi, before: offsetLo, after: offsetHi };
}

/**
 * How a gap reads, for the message: the wall time on each side of the jump.
 *
 * At the transition instant the clock reads `T + offsetBefore` one moment and
 * `T + offsetAfter` the next, and everything between those two readings never happened.
 * Those are wall-clock values rather than instants, so they are formatted by reading them
 * as if they were UTC, which is exactly what a wall time is: a number with no zone.
 */
function describeGap(wall: Wall, zone: string): { skippedFrom: string; skippedTo: string } {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const t = findTransition(asUtc - 24 * HOUR, asUtc + 24 * HOUR, zone);
  if (t === null) return { skippedFrom: "?", skippedTo: "?" };

  // A wall time is a number with no zone, so it is formatted by reading it as UTC. That is
  // not a trick: that is what a wall time is.
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  return { skippedFrom: hhmm(t.at + t.before), skippedTo: hhmm(t.at + t.after) };
}

/**
 * The instant for a wall time in a zone, or the reason there is not exactly one.
 *
 * Both candidates are checked against the requested fields, which is the whole mechanism: a
 * candidate that does not read back as what was asked for is not an answer, whatever the
 * arithmetic said.
 */
export function resolve(wall: Wall, zone: string): Resolved {
  // Two different refusals, because they need two different messages. "That is not a zone"
  // is unhelpful for someone who typed EST and had every reason to think it was one.
  if (!looksLikeIana(zone)) return { kind: "abbreviation", couldMean: suggestionFor(zone) };
  if (!formatterFor(zone)) return { kind: "unknown-zone" };

  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

  // A day either side. Every transition in the tz database is well under that, including
  // the historical ones that moved a zone by hours, so both possible offsets are in range.
  const before = offsetAt(asUtc - 24 * HOUR, zone);
  const after = offsetAt(asUtc + 24 * HOUR, zone);
  if (before === null || after === null) return { kind: "unknown-zone" };

  const candidates = [...new Set([asUtc - before, asUtc - after])];
  const valid = candidates.filter((instant) => sameWall(wallAt(instant, zone), wall)).sort((a, b) => a - b);

  if (valid.length === 0) return { kind: "gap", ...describeGap(wall, zone) };
  if (valid.length === 1) return { kind: "unique", instant: valid[0]! };
  // The earlier one is the answer and the other is named. Which is offered matters less than
  // that the second one is not hidden.
  return { kind: "ambiguous", instant: valid[0]!, other: valid[1]! };
}
