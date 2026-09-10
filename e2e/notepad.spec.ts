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
  const rows = await page.locator(".lines > div").count();
  // Asserted, not assumed. A zero row count makes the loop below run no assertions at all
  // and the test pass, which is exactly what happened when a stale preview of a different
  // app was serving the port: five tests failed loudly and this one reported green.
  expect(rows).toBeGreaterThan(10);
  for (let i = 0; i < rows; i++) {
    const line = await page.locator(".lines > div").nth(i).boundingBox();
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
  const line1 = await page.locator(".lines > div").nth(1).boundingBox();
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
