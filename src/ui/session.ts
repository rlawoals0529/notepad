/**
 * Where the document lives between visits, and what the page is when it is embedded.
 *
 * Two small things that both come from the same place: the URL and `localStorage`, neither
 * of which the rest of the app should have to know about.
 */

/** The key. Versioned, so a future change of format cannot read an old document as garbage. */
const KEY = "notepad.document.v1";

/**
 * Whether the page is inside a frame that provides its own chrome.
 *
 * `?embed=1`. The desktop overlay draws a title bar and a dismiss hint of its own, and a
 * second heading inside the frame is one too many.
 */
export function embedded(): boolean {
  try {
    return new URLSearchParams(location.search).get("embed") === "1";
  } catch {
    return false;
  }
}

/**
 * The document from last time, or nothing.
 *
 * Every access is wrapped, and that is not defensive habit: this app is loaded from a
 * `file:` URL inside the desktop overlay, where the origin is the string "null" and Chrome
 * throws on `localStorage` rather than returning null. A private window and a browser set
 * to block site data do the same. In all three cases the right behaviour is the same as a
 * first visit, and none of them should be an error on screen.
 */
export function load(): string | null {
  try {
    const held = localStorage.getItem(KEY);
    return typeof held === "string" && held.length > 0 ? held : null;
  } catch {
    return null;
  }
}

export function save(text: string): void {
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // Nothing useful to do, and nothing worth saying: the document is still on screen and
    // still works. Saying "could not save" on every keystroke would be worse than the
    // problem it reports.
  }
}

/**
 * Add a line to the end of a document, unless it is already the last one.
 *
 * What the overlay does with the clipboard when it is summoned. Appending rather than
 * replacing, because a notepad holds notes and the clipboard is not one of them: replacing
 * would throw away whatever you were in the middle of. The repeat guard is what makes
 * pressing the hotkey twice harmless.
 */
export function append(document: string, line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") return document;

  // A document that is only whitespace is an empty one, and appending to it would
  // concatenate the line onto those spaces rather than starting a document with it.
  if (document.trim() === "") return trimmed;

  const lines = document.split("\n");
  // A trailing blank line is where a document usually ends, so look past it.
  const last = [...lines].reverse().find((l) => l.trim() !== "");
  if (last?.trim() === trimmed) return document;

  const needsBlank = lines[lines.length - 1]?.trim() !== "";
  return `${document}${needsBlank ? "\n" : ""}${trimmed}`;
}

/**
 * Tell the host this page is listening.
 *
 * One message out, and it carries nothing but the fact that this page exists. Everything
 * else travels inwards, which is what makes the frame's `postMessage` safe to send with a
 * target origin of "*": there is no origin to name, because the host is loaded from a file
 * URL whose origin is the string "null".
 *
 * `parent` is a parameter so a test can hand it one, which is cheaper than a DOM.
 */
export function announceReady(parent: Window | null = globalThis.parent): void {
  if (!embedded()) return;
  // Posting to yourself is harmless but meaningless, and the guard makes that legible.
  if (!parent || parent === globalThis.self) return;
  parent.postMessage({ type: "hikari:ready" }, "*");
}
