/**
 * The production audit.
 *
 * This suite runs only when `DEFINIT_E2E_BASE` names a deployed URL, so it can
 * never be satisfied by a developer machine. It is the check that decides
 * whether the public deployment tells the truth:
 *
 *   * the deployment's own capability endpoint;
 *   * the no-wallet session, which must offer no live action it cannot perform;
 *   * the recorded-run fallback, which must still work;
 *   * the generated proof counts, on both pages that render them;
 *   * the responsive matrix from the repair brief;
 *   * zero console errors on every primary surface.
 *
 * The wallet section injects an EIP-1193 provider. It does not claim a live
 * transaction: it asserts the opposite -- that a provider which refuses to sign
 * produces a reported refusal and never a fabricated hash, and that the app
 * does not quietly hand the step to an operator key instead.
 */

import { expect, test, type Page } from "@playwright/test";

const REMOTE = process.env.DEFINIT_E2E_BASE;
const PRODUCTION_URL = process.env.DEFINIT_PRODUCTION_URL ?? "https://definit-snowy.vercel.app";

test.skip(!REMOTE, "production audit runs only against a deployed URL");

/** Collect console errors and page errors for the duration of a page's life. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    // Third-party noise is not our regression; only same-origin requests count.
    if (!request.url().startsWith(PRODUCTION_URL)) return;

    const reason = request.failure()?.errorText ?? "";
    // A cancelled prefetch is how Next.js abandons an RSC request during a
    // navigation. It is not a failure of the page being asserted.
    if (reason.includes("ERR_ABORTED")) return;

    problems.push(`requestfailed: ${request.url()} ${reason}`);
  });
  return problems;
}

// ------------------------------------------------------------ capabilities

test("the deployment publishes truthful capabilities", async ({ request }) => {
  const response = await request.get("/api/capabilities");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;

  expect(body.liveContracts).toBe(true);
  expect(body.browserWalletSigning).toBe(true);
  expect(body.operatorSigning).toBe(false);
  expect(body.runtimeMode).toBe("live");

  const network = body.network as { chainId: number; name: string; explorer: string };
  expect(network.chainId).toBe(61997);
  expect(network.explorer).toContain("explorer-studio-dev.genlayer.com");

  // No key, no key-shaped value, no environment echo.
  const serialised = JSON.stringify(body);
  expect(serialised).not.toMatch(/0x[0-9a-fA-F]{64}/);
  expect(serialised.toLowerCase()).not.toContain("private");
});

// ----------------------------------------------------------------- landing

test("the landing page loads, names the chain and shows no ASCII diagram", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("DEFINIT", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/61997/).first()).toBeVisible();
  await expect(page.getByText("FINALITY FIREWALL", { exact: false }).first()).toBeVisible();

  // The lifecycle is a rendered drawing, not a preformatted text block.
  expect(await page.locator("svg").count()).toBeGreaterThan(0);

  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src),
  );
  expect(broken).toEqual([]);

  expect(problems).toEqual([]);
});

// ------------------------------------------------------- no-wallet session

test("the lifecycle demo offers no live action without a wallet, and still replays", async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto("/demo", { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-signing-state="wallet-required"]')).toBeVisible();
  await expect(page.getByText("Wallet required for live actions")).toBeVisible();
  await expect(page.getByText("Operator fallback active")).toHaveCount(0);

  // Every step control is disabled rather than clickable-into-a-refusal.
  const runButtons = page.getByRole("button", { name: /^(Run|Connect wallet to run)$/ });
  const count = await runButtons.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let index = 0; index < count; index += 1) {
    await expect(runButtons.nth(index)).toBeDisabled();
    await expect(runButtons.nth(index)).toHaveText("Connect wallet to run");
  }

  // The fallback that does not need a signature still works.
  const replay = page.getByRole("button", { name: /Replay the recorded run/i });
  await expect(replay).toBeEnabled();
  await replay.click();
  await expect(page.getByText("Recorded live run")).toBeVisible();
  await expect(page.getByText(/outcome/i).first()).toBeVisible();

  expect(problems).toEqual([]);
});

test("the console refuses to register without a wallet", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/console", { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-signing-state="wallet-required"]')).toBeVisible();

  const register = page.getByRole("button", { name: "Connect wallet to register" });
  await expect(register).toBeVisible();
  await expect(register).toBeDisabled();
  await expect(page.getByRole("button", { name: "Register the demo action" })).toHaveCount(0);
  await expect(page.getByText("Operator fallback active")).toHaveCount(0);

  expect(problems).toEqual([]);
});

test("the new-action form cannot post into a disabled server path", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/actions/new", { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-signing-state="wallet-required"]')).toBeVisible();
  const submit = page.getByRole("button", { name: "Connect wallet to register" });
  await expect(submit).toBeVisible();
  await expect(submit).toBeDisabled();

  expect(problems).toEqual([]);
});

// ----------------------------------------------------------- proof counts

test("the evidence page renders the generated counts", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/proof", { waitUntil: "domcontentloaded" });

  const response = await page.request.get("/api/proof");
  expect(response.status()).toBe(200);
  const report = (await response.json()) as {
    caseCounts: { total: number; releaseExpected: number; refusalExpected: number };
    metrics: { passing: number; totalCases: number };
  };

  const summary = `${report.caseCounts.total} cases \u00b7 ${report.caseCounts.refusalExpected} refusal cases \u00b7 ${report.caseCounts.releaseExpected} release cases`;
  await expect(page.getByText(summary, { exact: false })).toBeVisible();
  await expect(
    page.getByText(`${report.metrics.passing} / ${report.metrics.totalCases} passing`, {
      exact: false,
    }),
  ).toBeVisible();

  expect(problems).toEqual([]);
});

test("the proof lab agrees with the evidence page", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/lab", { waitUntil: "domcontentloaded" });

  const declared = await page.locator("[data-case-counts]").first().getAttribute("data-case-counts");
  const response = await page.request.get("/api/proof");
  const report = (await response.json()) as { caseCounts: { total: number } };

  expect(Number(declared)).toBe(report.caseCounts.total);
  await expect(page.getByText(/passing/, { exact: false }).first()).toBeVisible();

  expect(problems).toEqual([]);
});

// -------------------------------------------------------------- docs index

test("the documentation index resolves every link", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/docs", { waitUntil: "domcontentloaded" });

  const links = page.locator('a[href^="/docs/"]');
  const count = await links.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute("href");
    const response = await page.request.get(href ?? "/docs");
    expect(response.status(), `${href} did not resolve`).toBeLessThan(400);
  }

  expect(problems).toEqual([]);
});

// ------------------------------------------------------------- responsive

const VIEWPORTS = [
  { width: 1920, height: 1080, name: "desktop-1920" },
  { width: 1440, height: 900, name: "desktop-1440" },
  { width: 1024, height: 768, name: "tablet-1024" },
  { width: 390, height: 844, name: "mobile-390" },
  { width: 375, height: 812, name: "mobile-375" },
];

const SURFACES = ["/", "/demo", "/console", "/proof", "/lab", "/actions/new"];

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: no overflow and no console errors`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const path of SURFACES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        metrics.scrollWidth,
        `${path} overflows at ${viewport.width}x${viewport.height}`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }

    expect(problems).toEqual([]);
  });
}

// --------------------------------------------------- provider-injected path

/**
 * A provider that connects and then refuses to sign.
 *
 * This is not a wallet and it is not a simulation of one: it exists to prove
 * the negative. If the application ever replaced a refused signature with an
 * operator signature, or rendered a transaction hash it did not receive, this
 * test would catch it, because this provider never returns one.
 */
async function injectRefusingProvider(page: Page) {
  await page.addInitScript(() => {
    const accounts = ["0x1111111111111111111111111111111111111111"];
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      _name: "Audit Provider",
      request: async (args: { method: string; params?: unknown[] }) => {
        switch (args.method) {
          case "eth_chainId":
            return "0xf22d"; // 61997
          case "net_version":
            return "61997";
          case "eth_accounts":
          case "eth_requestAccounts":
            return accounts;
          case "eth_getBalance":
            return "0x0";
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
            return null;
          default:
            // Every signing request is refused, in the shape a wallet uses.
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        }
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  });
}

test("a connected wallet is offered the wallet pathway, even though it signs nothing", async ({
  page,
}) => {
  await injectRefusingProvider(page);
  await page.goto("/demo", { waitUntil: "domcontentloaded" });

  // The page must not read a stale capability: the wallet is present now.
  //
  // The trigger's label depends on what the provider answered: with an account
  // already authorised it reads as the account, otherwise as "Connect wallet".
  // Either way it is the last control in the header, and either way the page
  // must move to the wallet pathway rather than offering an operator fallback.
  await page.locator("header button").last().click({ timeout: 15_000 }).catch(() => undefined);

  await expect(page.locator('[data-signing-state="wallet"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Ready to sign").first()).toBeVisible();
  await expect(page.getByText("operator will sign")).toHaveCount(0);

  // Running a step must surface the refusal, and must not invent a hash.
  const register = page.getByRole("button", { name: "Run" }).first();
  await expect(register).toBeEnabled();
  await register.click();

  await expect(page.getByText("refused", { exact: false }).first()).toBeVisible({
    timeout: 40_000,
  });

  // Nothing was signed, so nothing may be reported as landed, and no
  // transaction hash may be shown. A fabricated success is the failure mode
  // this test exists to catch.
  await expect(page.getByText("landed", { exact: false })).toHaveCount(0);
  await expect(page.getByText(/Verify on the explorer/)).toHaveCount(0);
});
