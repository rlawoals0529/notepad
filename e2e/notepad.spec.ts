import { expect, test } from "@playwright/test";

/**
 * The things that can only break in a browser.
 *
 * The language is covered by two hundred unit tests and none of them need a page. What
 * needs one is the part that is a property of layout rather than of code: whether an answer
 * is beside the line it belongs to. That is the failure this whole design is arranged
 * around, and it cannot be asserted anywhere else.
 */

test("the document you land on works, with an answer beside the right line", async ({ page }) => {
  await page.goto("/");
  const answers = page.locator(".answer");
  await expect(answers.nth(2)).toHaveText("240 km");
  await expect(answers.nth(8)).toHaveText("$107.20");
  await expect(answers.nth(11)).toHaveText("Sat 3 Oct 2026");
});

test("an answer stays level with its line, which is the one thing only a browser can check", async ({ page }) => {
  await page.goto("/");
  // Every answer's top must match its line number's top. If a line ever wraps, or the two
  // columns disagree about line height, everything below that point shifts by one row and
  // every answer is beside the wrong line while still looking perfectly plausible.
  const rows = await page.locator(".lines .track > div").count();
  // Asserted, not assumed. A zero row count makes the loop below run no assertions at all
  // and the test pass, which is exactly what happened when a stale preview of a different
  // app was serving the port: five tests failed loudly and this one reported green.
  expect(rows).toBeGreaterThan(10);
  for (let i = 0; i < rows; i++) {
    const line = await page.locator(".lines .track > div").nth(i).boundingBox();
    const answer = await page.locator(".answer").nth(i).boundingBox();
    expect(line, `line ${i + 1}`).not.toBeNull();
    expect(answer, `answer ${i + 1}`).not.toBeNull();
    expect(Math.abs(line!.y - answer!.y), `line ${i + 1} is not level with its answer`).toBeLessThan(1);
  }
});

test("a very long line does not wrap, because wrapping is what breaks the alignment", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".editor");
  await editor.fill(`${"1 + ".repeat(80)}1\n2 + 2`);
  const answers = page.locator(".answer");
  await expect(answers.nth(1)).toHaveText("4");
  const line1 = await page.locator(".lines .track > div").nth(1).boundingBox();
  const answer1 = await answers.nth(1).boundingBox();
  expect(Math.abs(line1!.y - answer1!.y)).toBeLessThan(1);
});

test("typing updates the margin, and a broken line leaves its neighbours alone", async ({ page }) => {
  await page.goto("/");
  await page.locator(".editor").fill("1 + 1\n3 m + 2 kg\n2 + 2");
  const answers = page.locator(".answer");
  await expect(answers.nth(0)).toHaveText("2");
  await expect(answers.nth(1)).toHaveText("length and mass do not add");
  await expect(answers.nth(2)).toHaveText("4");
});

test("a total says which lines it added, because an aggregate nobody can check is one to distrust", async ({ page }) => {
  await page.goto("/");
  await page.locator(".editor").fill("10\n20\n30\ntotal");
  const total = page.locator(".answer").nth(3);
  await expect(total).toHaveText("60");
  await expect(total).toHaveAttribute("title", "adds lines 1 to 3");
});

test("nothing on the page reaches the network after it has loaded", async ({ page }) => {
  // Not a privacy claim with a CSP behind it, as in the sibling repo, but worth asserting:
  // a notepad is where people put figures they would not paste into a website.
  const requests: string[] = [];
  await page.goto("/");
  page.on("request", (r) => requests.push(r.url()));
  await page.locator(".editor").fill("salary = $84,000\nsalary / 12");
  await expect(page.locator(".answer").nth(1)).toHaveText("$7,000");
  expect(requests).toEqual([]);
});

test("the ruling stays locked to the text, at every palette", async ({ page }) => {
  await page.goto("/");
  await page.locator(".editor").fill(
    Array.from({ length: 60 }, (_, i) => `item ${i + 1} = ${i + 1} * 3`).join("\n"),
  );

  // The pitch is derived from the type metrics, not written twice. If these ever disagree the
  // rules sit near the text instead of under it, which is the difference between a ledger and a
  // striped background.
  const metrics = await page.evaluate(() => {
    const ed = getComputedStyle(document.querySelector(".editor")!);
    const pitch = getComputedStyle(document.querySelector(".ruling")!).backgroundImage;
    return { lineHeight: parseFloat(ed.lineHeight), hasRuling: pitch.includes("gradient") };
  });
  expect(metrics.hasRuling).toBe(true);

  // The ruling travels with the other columns, not scrolled. The sheet itself never scrolls,
  // so a background fixed to it would sit still while the text moved over it. The gutter and
  // the margin move an inner track; the ruling moves its own paint, because a repeating
  // gradient has nothing to run out of and so needs no guessed-at extra height.
  await page.locator(".editor").evaluate((e) => {
    e.scrollTop = 204; // eight exact line pitches
    e.dispatchEvent(new Event("scroll"));
  });
  const moved = await page.evaluate(() => ({
    ruling: (document.querySelector(".ruling") as HTMLElement).style.backgroundPositionY,
    lines: (document.querySelector(".lines .track") as HTMLElement).style.transform,
    answers: (document.querySelector(".answers .track") as HTMLElement).style.transform,
  }));
  expect(moved.lines).toBe("translateY(-204px)");
  expect(moved.answers).toBe(moved.lines);
  expect(moved.ruling).toBe("calc(var(--rule-top) - 204px)");
  expect(204 % metrics.lineHeight).toBe(0); // still in phase

  /*
   * And in phase at a scroll that is NOT a whole number of lines, which is every scroll a
   * trackpad produces. Checking only a multiple of the pitch is checking the one case where
   * an off-by-a-phase cannot show up.
   */
  for (const top of [77, 332, 401]) {
    await page.locator(".editor").evaluate((e, t) => {
      e.scrollTop = t;
      e.dispatchEvent(new Event("scroll"));
    }, top);
    const worst = await page.evaluate((pitch) => {
      const ruling = document.querySelector(".ruling")!;
      const box = ruling.getBoundingClientRect();
      const start = parseFloat(getComputedStyle(ruling).backgroundPositionY);
      // Each rule is painted at the bottom of its repeat, so a line's bottom edge should land
      // on one exactly. Anything else is a rule beside the text rather than under it.
      return Math.max(
        ...[...document.querySelectorAll(".lines .track > div")].map((row) => {
          const y = row.getBoundingClientRect().bottom - box.top;
          return Math.abs(y - (start + Math.round((y - start) / pitch) * pitch));
        }),
      );
    }, metrics.lineHeight);
    expect(worst, `out of phase at scrollTop ${top}`).toBeLessThan(0.5);
  }
});

test("the gutter and the margin keep up after a scroll, all the way to the last line", async ({ page }) => {
  await page.goto("/");
  await page.locator(".editor").fill(Array.from({ length: 40 }, (_, i) => `${i + 1} + 1`).join("\n"));
  await page.locator(".editor").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
    e.dispatchEvent(new Event("scroll"));
  });

  // The failure this is here for: the transform used to be on the column, and `overflow:
  // hidden` clips to the element's own box, so once the box had slid up every row that
  // scrolled into view at the bottom fell outside it and drew nothing. On a thirty-line
  // document the gutter stopped at 18 and a dozen answers were simply missing.
  const seen = await page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
    /*
     * Measured against the CLIP, not against the sheet.
     *
     * A row that has been clipped away still reports a perfectly good bounding box: geometry
     * cannot see `overflow: hidden`. So each row is checked against its own column's box as
     * well, which is the box that does the clipping - and the box that used to slide off the
     * top, taking the clip with it.
     */
    const inView = (column: string, rows: string) => {
      const clip = document.querySelector(column)!.getBoundingClientRect();
      const top = Math.max(sheet.top, clip.top);
      const bottom = Math.min(sheet.bottom, clip.bottom);
      return [...document.querySelectorAll(`${column} ${rows}`)]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.top >= top - 1 && r.bottom <= bottom + 1;
        })
        .map((e) => e.textContent!.trim());
    };
    return { gutter: inView(".lines", ".track > div"), answers: inView(".answers", ".track > .answer") };
  });

  // The last line of the document is on screen, so its number and its answer are too.
  expect(seen.gutter).toContain("40");
  expect(seen.answers).toContain("41");
  // And the two columns agree about how much is showing, or one of them is being clipped.
  expect(seen.gutter.length).toBe(seen.answers.length);
});

test("reset goes back to the example, and the example is not the last word", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".editor");
  const example = await editor.inputValue();

  await editor.fill("kept = 5\nkept * 3");
  await expect(page.locator(".answer").nth(1)).toHaveText("15");

  await page.getByRole("button", { name: "Reset" }).click();
  expect(await editor.inputValue()).toBe(example);

  // A textarea's own undo does not cover a value set from code, so without this the button
  // would be one click between somebody and everything they had typed, with no way back.
  await page.getByRole("button", { name: "Undo reset" }).click();
  expect(await editor.inputValue()).toBe("kept = 5\nkept * 3");

  // And the offer expires when you move on, rather than sitting there over a document it no
  // longer describes.
  await editor.press("End");
  await editor.type("0");
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo reset" })).toBeHidden();
});

test("what reset leaves behind is what comes back on reload", async ({ page }) => {
  await page.goto("/");
  await page.locator(".editor").fill("typed = 1");
  await page.getByRole("button", { name: "Reset" }).click();
  const afterReset = await page.locator(".editor").inputValue();

  // Every change is written through to storage, and a reset is a change. Reloading onto the
  // document somebody just cleared would be the reset quietly not having happened.
  await page.reload();
  expect(await page.locator(".editor").inputValue()).toBe(afterReset);
});

test("the server under test is this app, not another app on the same port", async ({ page }) => {
  await page.goto("/");
  /*
   * playwright.config.ts reuses a server that is already listening, so a port two projects
   * share means one project's running preview quietly answers the other's tests. That has
   * happened here twice, and once it produced a completely green run against the wrong page.
   * Ports are unique now; this is what catches the next way it goes wrong.
   */
  await expect(page).toHaveTitle(/^notepad/);
});
