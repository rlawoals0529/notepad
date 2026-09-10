/**
 * The document, its answers, and the one thing that keeps them level.
 *
 * Three columns that scroll as one: line numbers, the textarea, and the margin. The
 * textarea is the only scrollable one, and the other two are moved to match it, because a
 * textarea's scroll cannot be driven from outside without fighting the caret.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { run } from "../lang/evaluate";
import { format } from "../format";
import { EXAMPLE } from "./example";

export function App() {
  const [text, setText] = useState(EXAMPLE);
  const [lit, setLit] = useState<readonly number[]>([]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const answers = useRef<HTMLDivElement>(null);

  // One evaluation per change, and only when the text actually changed. The whole document
  // is re-run rather than diffed: a line can depend on any line above it, so there is no
  // smaller correct unit, and the work is a few hundred microseconds on a document nobody
  // will ever scroll to the bottom of.
  const sheet = useMemo(() => run(text), [text]);

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
    <div className="page">
      <header className="bar">
        <h1>notepad</h1>
        <span className="hint">
          {withValues} {withValues === 1 ? "answer" : "answers"}
          {failing > 0 ? `, ${failing} not working` : ""}
        </span>
      </header>

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

      <footer className="foot">
        <span>Every line is worked out on its own.</span>
        <span className="spacer" />
        <span>Nothing leaves this page.</span>
      </footer>
    </div>
  );
}
