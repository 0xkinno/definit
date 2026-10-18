import { expect, test, type Page } from "@playwright/test";

/**
 * Milestone v1 surfaces: the pages render their generated numbers, nothing
 * overflows, the finality clocks are laid out in time order inside their
 * container, there are no console errors, and the wallet path issues a signing
 * request to the gate when the injected wallet approves.
 *
 * The injected provider is a test double, not a wallet. It proves the application
 * builds the request and addresses it to the deployed gate. The live signing on
 * chain was done by the lifecycle runner (docs/evidence/milestone/v1-run-*.json).
 */

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

test("the milestone page renders the proof line, three clocks and the live contracts", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/milestone", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1 })).toContainText("finality");
  const line = await page.getByTestId("proof-line").innerText();
  expect(line).toMatch(/pay-on-Accepted agent executed \d+\/\d+/);
  expect(line).toMatch(/DEFINIT v1 0\/\d+/);

  await expect(page.getByRole("figure")).toHaveCount(3);
  const addresses = await page.locator('a.hash[href*="explorer-studio-dev.genlayer.com/address/"]').allInnerTexts();
  expect(addresses.length).toBeGreaterThanOrEqual(3);
  for (const a of addresses) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);

  // No horizontal overflow at any width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});

test("each finality clock keeps its nodes in time order inside the figure", async ({ page }) => {
  await page.goto("/milestone", { waitUntil: "networkidle" });
  const figures = page.getByRole("figure");
  const n = await figures.count();
  for (let i = 0; i < n; i++) {
    const fig = figures.nth(i);
    const box = await fig.boundingBox();
    const nodes = fig.locator("a[aria-label]");
    expect(await nodes.count()).toBe(4);
    let last = -Infinity;
    for (let k = 0; k < 4; k++) {
      const b = await nodes.nth(k).boundingBox();
      expect(b).not.toBeNull();
      expect(b!.x).toBeGreaterThanOrEqual(box!.x - 1);
      expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
      expect(b!.x).toBeGreaterThanOrEqual(last - 1); // proposed <= accepted <= final <= delivered
      last = b!.x;
    }
  }
});

test("the refusal breakdown on the milestone page sums to its total", async ({ page }) => {
  await page.goto("/milestone", { waitUntil: "networkidle" });
  const header = await page.getByText(/Count \(sums to \d+\)/i).innerText();
  const total = Number(/sums to (\d+)/i.exec(header)![1]);
  const table = page.locator("table", { has: page.getByText(/Count \(sums to/i) });
  const counts = (await table.locator("tbody tr td:nth-child(2)").allInnerTexts()).map(Number);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
});

test("the landing hero states the pain and carries the generated proof line", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your agent paid on an AI verdict");
  await expect(page.getByTestId("hero-proof")).toContainText("DEFINIT v1");
  await page.getByRole("link", { name: "See the finality clock and the proof" }).first().click();
  await expect(page).toHaveURL(/\/milestone$/);
  expect(problems).toEqual([]);
});

test("the proof page shows live addresses and a refusal breakdown with no wallet", async ({ page }) => {
  await page.goto("/proof", { waitUntil: "networkidle" });
  const list = page.getByTestId("live-contracts");
  await expect(list).toBeVisible();
  expect((await list.locator("a").allInnerTexts()).length).toBe(3);
  const text = await page.getByTestId("refusal-breakdown").innerText();
  const refused = Number(/refused (\d+) attempts/.exec(text)![1]);
  const parts = [...text.matchAll(/(\d+) [A-Z_]{4,}/g)].map((m) => Number(m[1]));
  expect(parts.reduce((a, b) => a + b, 0)).toBe(refused);
});

test("a connected wallet that approves is asked to sign a transaction addressed to a contract", async ({ page }) => {
  const requests: Array<{ method: string; params?: unknown[] }> = [];
  await page.exposeFunction("recordRequest", (r: { method: string; params?: unknown[] }) => requests.push(r));
  await page.addInitScript(() => {
    const accounts = ["0x1111111111111111111111111111111111111111"];
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async (args: { method: string; params?: unknown[] }) => {
        (window as unknown as { recordRequest: (r: unknown) => void }).recordRequest(args);
        switch (args.method) {
          case "eth_chainId": return "0xf22d";
          case "net_version": return "61997";
          case "eth_accounts":
          case "eth_requestAccounts": return accounts;
          case "eth_getBalance": return "0x" + (10n ** 20n).toString(16);
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain": return null;
          case "eth_sendTransaction": return "0x" + "ab".repeat(32);
          default: return null;
        }
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  });
  await page.goto("/demo", { waitUntil: "domcontentloaded" });
  await page.locator("header button").last().click({ timeout: 15_000 }).catch(() => undefined);
  await expect(page.locator('[data-signing-state="wallet"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Ready to sign").first()).toBeVisible();

  const methods = requests.map((r) => r.method);
  expect(methods).toContain("eth_accounts");
  expect(methods).toContain("eth_chainId");

  await page.getByRole("button", { name: "Run" }).first().click();
  await expect.poll(() => requests.some((r) => r.method === "eth_sendTransaction"), { timeout: 40_000 }).toBe(true);
  const send = requests.find((r) => r.method === "eth_sendTransaction")!;
  const tx = (send.params?.[0] ?? {}) as { from?: string; to?: string; data?: string };
  expect(tx.from?.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");
  expect(tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(tx.data ?? "").toMatch(/^0x[0-9a-fA-F]{8,}/);
});
