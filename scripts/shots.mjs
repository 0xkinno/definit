/**
 * Capture the acceptance screenshots.
 *
 * The product is judged on a phone as much as on a desktop, so the shots are
 * taken at the two viewports that matter most: the 390x844 acceptance viewport
 * and a wide desktop. The page list is short on purpose -- a screenshot that
 * is not looked at is not evidence.
 *
 * Usage:
 *
 *     npm run shots            (expects the app on http://localhost:3000)
 */

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const BASE = process.env.DEFINIT_SHOT_BASE ?? "http://localhost:3000";
const OUT = path.join(REPO_ROOT, "public", "shots");

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

const PAGES = [
  { name: "landing", route: "/" },
  { name: "console", route: "/console" },
  { name: "proof-lab", route: "/lab" },
  { name: "evidence", route: "/proof" },
  ...(actionId
    ? [
        { name: "lifecycle", route: `/actions/${actionId}` },
        { name: "receipt", route: `/receipts/${actionId}` },
      ]
    : []),
];

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
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
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    for (const target of PAGES) {
      // The phone shot keeps the plain name because the phone is the
      // acceptance viewport and it is the one the documentation links to.
      const suffix = viewport.name === "phone" ? "" : `-${viewport.name}`;
      await page.goto(`${BASE}${target.route}`, { waitUntil: "networkidle" });
      const file = path.join(OUT, `${target.name}${suffix}.png`);
      await page.screenshot({ path: file, fullPage: true });
      log.ok(`public/shots/${target.name}${suffix}.png`);
    }
    await context.close();
  }

  await browser.close();
  log.ok("screenshots captured");
}

main().catch((error) => {
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
