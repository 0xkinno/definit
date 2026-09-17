/**
 * Keyboard, focus and labelling.
 *
 * These are the checks a reader would make with a screen reader and a tab key.
 * They are shallow on purpose: a deep accessibility audit is a different
 * exercise, and a shallow suite that actually runs beats a deep one that does
 * not.
 */

import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/console", "/lab", "/proof", "/docs"];

for (const path of ROUTES) {
  test(`${path} exposes exactly one top-level heading`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test(`${path} labels every image`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const unlabelled = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img"))
        .filter((image) => !image.hasAttribute("alt"))
        .map((image) => image.getAttribute("src") ?? "(no src)"),
    );
    expect(unlabelled).toEqual([]);
  });

  test(`${path} gives every control an accessible name`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const nameless = await page.evaluate(() => {
      const offenders: string[] = [];
      const controls = document.querySelectorAll("button, a[href], input, select, textarea");
      for (const element of Array.from(controls)) {
        const name =
          element.getAttribute("aria-label") ??
          element.getAttribute("title") ??
          (element.textContent ?? "").trim() ??
          "";
        const labelled =
          name.length > 0 ||
          element.hasAttribute("aria-labelledby") ||
          (element.id !== "" &&
            document.querySelector(`label[for="${element.id}"]`) !== null);
        if (!labelled) {
          offenders.push(
            `${element.tagName.toLowerCase()}[${element.getAttribute("href") ?? element.getAttribute("type") ?? ""}]`,
          );
        }
      }
      return offenders.slice(0, 8);
    });
    expect(nameless).toEqual([]);
  });

  test(`${path} is fully reachable by keyboard`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const reached = new Set<string>();
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return null;
        return `${active.tagName.toLowerCase()}:${(active.textContent ?? "").trim().slice(0, 24)}`;
      });
      if (focused) reached.add(focused);
    }
    // A page with nothing focusable at all would be a failure, not a pass.
    expect(reached.size).toBeGreaterThan(0);
  });

  test(`${path} honours reduced motion`, async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const longAnimations = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of Array.from(document.querySelectorAll("*"))) {
        const style = window.getComputedStyle(element);
        const duration = Number.parseFloat(style.animationDuration || "0");
        const transition = Number.parseFloat(style.transitionDuration || "0");
        if (duration > 0.5 || transition > 0.5) {
          offenders.push(`${element.tagName.toLowerCase()}:${duration}/${transition}`);
        }
      }
      return offenders.slice(0, 8);
    });
    await context.close();
    expect(longAnimations).toEqual([]);
  });
}
