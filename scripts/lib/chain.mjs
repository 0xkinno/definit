/**
 * Network plumbing shared by the v2 live scripts.
 *
 * Studio-dev rate-limits at 500 requests per hour per account, so every call
 * goes through `pace`, which waits out a stated retry window instead of
 * failing, and retries a bounded number of times on a transient gateway page.
 * The request count is kept so a run can report what it used.
 *
 * `gen_getTransactionLifecycle` takes `{ txId }` on this endpoint although the
 * SDK's typed wrapper sends `{ hash }` (spike observation O1), so lifecycle
 * reads go through the raw RPC.
 */

import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

import { readEnv, log } from "../_shared.mjs";

export const counter = { calls: 0, waitedMs: 0 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export const RPC = readEnv().GENLAYER_RPC_URL || studioDevnet.rpcUrls.default.http[0];

export async function pace(fn) {
  let transient = 0;
  for (;;) {
    try {
      counter.calls += 1;
      return await fn();
    } catch (error) {
      const text = `${error?.message ?? ""} ${JSON.stringify(error?.cause ?? {})}`;
      if (/<html|Unexpected token '<'|502 Bad Gateway|503 Service|504 Gateway|ECONNRESET|fetch failed/i.test(text) && (transient += 1) <= 6) {
        log.warn(`transient gateway response, retry ${transient}`);
        await sleep(8000 * transient);
        continue;
      }
      if (!/Rate limit exceeded/i.test(text)) throw error;
      const wait = Number(/retry_after_seconds"?:\s*(\d+)/.exec(text)?.[1] ?? 120) + 5;
      log.warn(`rate limited, waiting ${wait}s`);
      counter.waitedMs += wait * 1000;
      await sleep(wait * 1000);
    }
  }
}

export async function rpc(method, params) {
  return pace(async () => {
    const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = await response.json();
    if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { cause: body.error });
    return body.result;
  });
}

export const lifecycle = (txId) => rpc("gen_getTransactionLifecycle", [{ txId }]);
export const getTx = (hash) => rpc("eth_getTransactionByHash", [hash]);
export const balanceOf = async (address) => BigInt(await rpc("eth_getBalance", [address, "latest"]));

export function makeClient() {
  const key = readEnv().GENLAYER_PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("GENLAYER_PRIVATE_KEY is missing or malformed in .env.local");
  const account = createAccount(key);
  const chain = { ...studioDevnet, rpcUrls: { default: { http: [RPC] } } };
  return { client: createClient({ chain, account }), account };
}

export async function ensureFunded(account, minimumGen = 20n) {
  const have = await balanceOf(account.address);
  if (have < minimumGen * 10n ** 18n) await rpc("sim_fundAccount", [account.address, 1000 * 10 ** 18]);
}

export const unix = (iso) => Math.floor(Date.parse(iso) / 1000);
export const explorerTx = (hash) => `https://explorer-studio-dev.genlayer.com/tx/${hash}`;
export const explorerAddress = (address) => `https://explorer-studio-dev.genlayer.com/address/${address}`;
