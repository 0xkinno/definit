/**
 * Capture the README imagery.
 *
 * One banner and four product screenshots, all landscape and all desktop.
 * Nothing here is a full-page capture: a tall image that is mostly whitespace
 * communicates less than a wide one that is all content, and it renders badly
 * in every document viewer.
 *
 * `PRODUCT` is deliberately four pages. It is the journey rather than a
 * gallery: drive the lifecycle, sign it with a wallet, follow one action, and
 * read the receipt it produced.
 *
 * Usage:
 *
 *     npm run shots            (expects the app on http://localhost:3000)
 */

import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const BASE = process.env.DEFINIT_SHOT_BASE ?? "http://localhost:3000";
const OUT = path.join(REPO_ROOT, "public", "shots");

/** Wide enough to be landscape in every viewer, small enough to stay light. */
const VIEWPORT = { width: 1440, height: 900 };

/**
 * The banner is a wide crop of the landing hero, taken at the banner aspect
 * the README uses so the markdown never has to rescale it.
 */
const BANNER = { name: "landing", route: "/", clip: { x: 0, y: 0, width: 1440, height: 640 } };

/**
 * The lifecycle and receipt screens are addressed by the action that a live
 * run settled. The record is read rather than hardcoded so a fresh run moves
 * the screenshots with it, and the pages are skipped when no run exists.
 */
function settledActionId() {
  try {
    const record = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "docs", "evidence", "live-lifecycle.json"), "utf8"),
    );
    const id = String(record.actionId ?? "");
    return /^0x[0-9a-fA-F]{64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const actionId = settledActionId();
if (!actionId) {
  log.warn("docs/evidence/live-lifecycle.json has no action id -- lifecycle and receipt shots will be skipped");
}

const PRODUCT = [
  { name: "console", route: "/console" },
  { name: "demo", route: "/demo" },
  ...(actionId
    ? [
        { name: "lifecycle", route: `/actions/${actionId}` },
        { name: "receipt", route: `/receipts/${actionId}` },
      ]
    : []),
];

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    log.fail("playwright is not installed. Run `npx playwright install chromium` first.");
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });

  // Remove every previous capture first. A stale file that no longer matches
  // the page it names is worse than a missing one.
  for (const entry of readdirSync(OUT)) {
    if (entry.endsWith(".png")) rmSync(path.join(OUT, entry));
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  const targets = [BANNER, ...PRODUCT];
  for (const target of targets) {
    await page.goto(`${BASE}${target.route}`, { waitUntil: "networkidle" });
    // Let the webfonts settle so no shot is taken mid-swap.
    await page.waitForTimeout(900);
    /**
     * The framework injects a floating developer badge into a portal. It is
     * not part of the product, so it is removed once the page has settled.
     */
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const file = path.join(OUT, `${target.name}.png`);
    await page.screenshot({
      path: file,
      fullPage: false,
      ...(target.clip ? { clip: target.clip } : {}),
    });
    log.ok(`public/shots/${target.name}.png`);
  }

  await context.close();
  await browser.close();
  log.ok("screenshots captured");
}

main().catch((error) => {
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
