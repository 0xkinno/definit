import { expect, test, type Page } from "@playwright/test";

/**
 * The milestone v1 console. Without a wallet it is readable and its writes are
 * disabled with a reason. With an injected wallet that approves, the application
 * quotes through the Transaction Kit and asks the wallet to sign a transaction
 * addressed to a contract. The injected provider is a test double; the live
 * signing on chain is recorded in docs/evidence/milestone/agent-run-*.json.
 */

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

test("without a wallet the v1 console is readable and every write is disabled with a reason", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/console", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("protocol-delivered finality");
  await expect(page.getByTestId("v1-gate-note")).toContainText("Connect a wallet");
  for (const step of ["propose", "fund", "adjudicate", "contest", "withdraw"]) {
    await expect(page.locator(`[data-step="${step}"]`)).toBeDisabled();
  }
  await expect(page.getByTestId("fee-receipt")).toContainText("no quote yet");
  await expect(page.getByRole("link", { name: "/console/v0" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});

test("the appeal posture copy follows the selection", async ({ page }) => {
  await page.goto("/console", { waitUntil: "networkidle" });
  await page.locator("#posture").selectOption("high");
  await expect(page.getByText("Higher posture funds more appeal rounds")).toBeVisible();
  await page.locator("#posture").selectOption("low");
  await expect(page.getByText("Funds 1 appeal round")).toBeVisible();
});

test("a connected wallet is asked to sign the proposal, after a Transaction Kit quote", async ({ page }) => {
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
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  await page.locator("header button").last().click({ timeout: 15_000 }).catch(() => undefined);
  await expect(page.locator('[data-step="propose"]')).toBeEnabled({ timeout: 25_000 });

  await page.locator('[data-step="propose"]').click();
  await expect.poll(() => requests.some((r) => r.method === "eth_sendTransaction"), { timeout: 45_000 }).toBe(true);
  const tx = (requests.find((r) => r.method === "eth_sendTransaction")!.params?.[0] ?? {}) as { from?: string; to?: string; data?: string; value?: string };
  expect(tx.from?.toLowerCase()).toBe("0x1111111111111111111111111111111111111111");
  expect(tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(tx.data ?? "").toMatch(/^0x[0-9a-fA-F]{8,}/);
  // the quote came from the kit with the committed profile, and it was verified
  await expect(page.getByTestId("fee-receipt")).toContainText("developer");
  await expect(page.getByTestId("fee-receipt")).toContainText("verified");
});
