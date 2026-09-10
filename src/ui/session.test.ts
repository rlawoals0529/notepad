import { describe as group, expect, test } from "vitest";
import { announceReady, append } from "./session";

group("adding the clipboard to a document", () => {
  test("it goes on the end", () => {
    expect(append("1 + 1", "2 + 2")).toBe("1 + 1\n2 + 2");
  });

  test("an empty document takes it without a leading blank line", () => {
    expect(append("", "2 + 2")).toBe("2 + 2");
    expect(append("   ", "2 + 2")).toBe("2 + 2");
  });

  test("a document that already ends in a blank line does not gain another", () => {
    expect(append("1 + 1\n", "2 + 2")).toBe("1 + 1\n2 + 2");
  });

  test("pressing the hotkey twice does not add the line twice", () => {
    // The guard that makes summoning the overlay repeatedly harmless, which is exactly what
    // somebody does when they are looking for the window.
    const once = append("1 + 1", "2 + 2");
    expect(append(once, "2 + 2")).toBe(once);
  });

  test("and still does not, when the document ends with blank lines after it", () => {
    const doc = "1 + 1\n2 + 2\n\n";
    expect(append(doc, "2 + 2")).toBe(doc);
  });

  test("a different line is added even when a matching one is further up", () => {
    expect(append("2 + 2\n1 + 1", "2 + 2")).toBe("2 + 2\n1 + 1\n2 + 2");
  });

  test("nothing at all is ignored rather than adding a blank line", () => {
    for (const nothing of ["", "   ", "\n", "\t"]) {
      expect(append("1 + 1", nothing)).toBe("1 + 1");
    }
  });

  test("the added line is trimmed, since a clipboard usually carries a newline", () => {
    expect(append("1 + 1", "  2 + 2\n")).toBe("1 + 1\n2 + 2");
  });
});

group("announcing that the page is listening", () => {
  /** A stand-in for the host window: records what it was sent. */
  const spy = () => {
    const sent: unknown[] = [];
    return { window: { postMessage: (m: unknown) => sent.push(m) } as unknown as Window, sent };
  };

  test("it says nothing when the page is not embedded", () => {
    // A browser tab has no host to tell, and posting to whatever is above it would be the
    // one outbound message this app makes, sent for no reason.
    const host = spy();
    announceReady(host.window);
    expect(host.sent).toEqual([]);
  });

  test("it says nothing when the page is its own parent", () => {
    const host = spy();
    announceReady(null);
    expect(host.sent).toEqual([]);
    announceReady(globalThis.self);
    expect(host.sent).toEqual([]);
  });

  test("the message carries no data, only the fact that the page exists", () => {
    // The property the frame's comment depends on: text goes in, and what comes back out is
    // not data. A field added here would quietly make that untrue.
    const original = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: { search: "?embed=1" },
      configurable: true,
    });
    try {
      const host = spy();
      announceReady(host.window);
      expect(host.sent).toEqual([{ type: "hikari:ready" }]);
      expect(Object.keys(host.sent[0] as object)).toEqual(["type"]);
    } finally {
      Object.defineProperty(globalThis, "location", { value: original, configurable: true });
    }
  });
});
