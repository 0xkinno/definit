/**
 * The viewport matrix.
 *
 * The acceptance viewport is a phone in portrait, so a surface that only works
 * on a desktop is not finished. Each project in `playwright.config.ts` pins one
 * width; the assertions here are the same at every one of them.
 */

import { expect, test } from "@playwright/test";

/** Surfaces that render without a network read, so they are stable to assert. */
const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/console", name: "console" },
  { path: "/lab", name: "proof lab" },
  { path: "/proof", name: "evidence" },
  { path: "/docs", name: "documentation index" },
];

for (const route of ROUTES) {
  test(`${route.name} does not overflow its viewport`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      // One pixel of rounding slack: sub-pixel layout legitimately reports a
      // fractional scrollWidth on some engines.
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
    });

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test(`${route.name} keeps touch targets usable`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });

    const tooSmall = await page.evaluate(() => {
      const selector = "a, button, [role=button], input, select, textarea";
      const offenders: string[] = [];
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        // Inline links inside prose are exempt: they are read, not tapped as
        // primary controls, and forcing them to 44px would break the text.
        const inline = element.tagName === "A" && style.display.startsWith("inline");
        if (inline) continue;
        if (box.height < 32 || box.width < 32) {
          offenders.push(`${element.tagName.toLowerCase()}:${box.width}x${box.height}`);
        }
      }
      return offenders.slice(0, 8);
    });

    expect(tooSmall).toEqual([]);
  });
}
