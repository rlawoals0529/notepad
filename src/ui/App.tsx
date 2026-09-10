/**
 * The document, its answers, and the one thing that keeps them level.
 *
 * Three columns that scroll as one: line numbers, the textarea, and the margin. The
 * textarea is the only scrollable one, and the other two are moved to match it, because a
 * textarea's scroll cannot be driven from outside without fighting the caret.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { run } from "../lang/evaluate";
import { format } from "../format";
import { EXAMPLE } from "./example";
import { announceReady, append, embedded, load, save } from "./session";

const EMBED = embedded();

export function App() {
  // Last time's document, or the example. A first visit gets something to look at; every
  // visit after that gets what they left.
  const [text, setText] = useState(() => load() ?? EXAMPLE);
  const [lit, setLit] = useState<readonly number[]>([]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const answers = useRef<HTMLDivElement>(null);

  // One evaluation per change, and only when the text actually changed. The whole document
  // is re-run rather than diffed: a line can depend on any line above it, so there is no
  // smaller correct unit, and the work is a few hundred microseconds on a document nobody
  // will ever scroll to the bottom of.
  const sheet = useMemo(() => run(text), [text]);

  // Written on every change. It is one small string and a synchronous write, and the
  // alternative -- debouncing -- buys nothing here and loses the last few keystrokes of
  // anybody who closes the tab mid-thought.
  useEffect(() => save(text), [text]);

  /**
   * The clipboard, pushed in by the desktop overlay when it is summoned.
   *
   * The only message this page listens for, and only in embedded mode: in a browser there
   * is no clipboard access and none is asked for. It appends rather than replaces, because
   * a notepad holds notes and throwing them away to make room for the clipboard is not a
   * trade anybody would choose.
   *
   * The sender is not checked and cannot usefully be: the host page is loaded from a file
   * URL, whose origin is the string "null". What makes it safe is that the message carries
   * text in and nothing goes back out, so it cannot be used to read this page.
   */
  useEffect(() => {
    if (!EMBED) return;
    const onMessage = (e: MessageEvent) => {
      const data: unknown = e.data;
      if (typeof data !== "object" || data === null) return;
      const { type, text: incoming } = data as { type?: unknown; text?: unknown };
      if (type !== "hikari:paste" || typeof incoming !== "string") return;
      setText((current) => append(current, incoming));
      // The caret goes to the end, so the line that just arrived is the one being edited.
      queueMicrotask(() => {
        const el = editor.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    };
    window.addEventListener("message", onMessage);
    // After the listener, never before. The host used to push on the iframe's load event,
    // which fires while this effect has not run yet, so the clipboard was posted into a page
    // with nobody listening and the overlay opened without it.
    announceReady();
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /**
   * Keep the other two columns level with the textarea.
   *
   * They are not scrollable themselves, they are translated. Setting `scrollTop` on a
   * sibling works until the caret moves the textarea on its own, at which point the two
   * scroll positions fight each other for a frame and the margin visibly lags.
   */
  const sync = useCallback(() => {
    const top = editor.current?.scrollTop ?? 0;
    for (const el of [lines.current, answers.current]) {
      if (el) el.style.transform = `translateY(${-top}px)`;
    }
  }, []);

  const rows = sheet.rows;
  const withValues = rows.filter((r) => r.value.kind !== "none").length;
  const failing = rows.filter((r) => r.value.kind === "error").length;

  return (
    <div className={EMBED ? "page embed" : "page"}>
      {/* The overlay draws its own title bar and dismiss hint, so a second heading inside
          the frame is one too many. */}
      {EMBED ? null : (
        <header className="bar">
          <h1>notepad</h1>
          <span className="hint">
            {withValues} {withValues === 1 ? "answer" : "answers"}
            {failing > 0 ? `, ${failing} not working` : ""}
          </span>
        </header>
      )}

      <div className="sheet">
        <div className="lines" ref={lines} aria-hidden="true">
          {rows.map((r) => (
            <div key={r.line} className={lit.includes(r.line) ? "row-lit" : undefined}>
              {r.line}
            </div>
          ))}
        </div>

        <textarea
          ref={editor}
          className="editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onScroll={sync}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Your notes. Each line is worked out on its own."
          placeholder="Type a line."
        />

        <div className="answers" ref={answers} aria-live="polite">
          {rows.map((r) => {
            const window = sheet.windows.get(r.line);
            const said = format(r.value);
            const kind =
              r.value.kind === "none" ? "blank"
              : r.value.kind === "error" ? "said"
              : window !== undefined ? "total"
              : r.name !== undefined ? "name"
              : "";
            return (
              <div
                key={r.line}
                className={`answer ${kind}`.trim()}
                title={window !== undefined && window.length > 0 ? `adds lines ${window[0]} to ${window[window.length - 1]}` : said}
                onMouseEnter={() => setLit(window ?? [])}
                onMouseLeave={() => setLit([])}
              >
                {said === "" ? " " : said}
              </div>
            );
          })}
        </div>
      </div>

      {EMBED ? null : (
        <footer className="foot">
          <span>Every line is worked out on its own.</span>
          <span className="spacer" />
          <span>Nothing leaves this page.</span>
        </footer>
      )}
    </div>
  );
}
