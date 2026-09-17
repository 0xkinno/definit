/**
 * Shared plumbing for the command-line tools.
 *
 * Every script here talks to the same network with the same account and reads
 * the same environment file. Keeping that in one place means the deployment
 * script, the lifecycle driver and the verifier cannot disagree about which
 * chain they are pointed at.
 *
 * Nothing in this file decides anything about finality. It moves bytes.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient } from "genlayer-js";
import { studionet, studioDevnet } from "genlayer-js/chains";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = path.join(REPO_ROOT, ".env.local");
export const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts");
export const DEPLOYMENT_PATH = path.join(ARTIFACTS_DIR, "deployment.json");

/** Chain 61997 is the submission target. See docs/DISCOVERY.md. */
export const TARGET_CHAIN_ID = 61997;

/** Last fee quote that the network answered with, reused if a later quote fails. */
let lastGoodQuote = null;

/** The recorded message fee-parameter blob. See scripts/fee-template.mjs. */
let messageTemplate;

function loadMessageTemplate() {
  if (messageTemplate !== undefined) return messageTemplate;
  try {
    messageTemplate = JSON.parse(
      readFileSync(path.join(ARTIFACTS_DIR, "fee-template.json"), "utf8"),
    );
  } catch {
    messageTemplate = null;
  }
  return messageTemplate;
}

/**
 * Price a call that emits internal messages when the network cannot simulate it.
 *
 * `sim_estimateTransactionFees` executes the call, so it cannot price a call
 * that is expected to revert, or one whose contract logic reads chain time --
 * and both of those describe the promotion and the release. When the simulated
 * quote is unavailable the tree is built from the policy quote instead, with one
 * allocation per internal message. Only the encoded `feeParams` blob is not
 * derivable from the quote, so one blob is recorded from the network in
 * `artifacts/fee-template.json` and reused.
 *
 * Returns null when there is nothing to build from, so the caller can fall back.
 */
function synthesiseMessageFees(estimate, recipients) {
  const template = loadMessageTemplate();
  if (!template?.messageAllocation) return null;

  const budget = BigInt(template.messageAllocation.budget);
  const totalMessageFees = budget * BigInt(recipients.length);
  return {
    distribution: { ...estimate.distribution, totalMessageFees },
    feeValue: BigInt(estimate.feeValue) + totalMessageFees,
    messageAllocations: recipients.map((recipient) => ({
      messageType: template.messageAllocation.messageType,
      onAcceptance: template.messageAllocation.onAcceptance,
      parentIndex: BigInt(template.messageAllocation.parentIndex),
      recipient,
      callKey: template.callKeyWildcard,
      budget,
      feeParams: template.messageAllocation.feeParams,
    })),
  };
}

/**
 * The organizer RPC and the historical Studio endpoint resolve to the same
 * environment on chain 61997. `studioDevnet` in genlayer-js already points at
 * the historical name, so the chain object is taken from the SDK and only the
 * endpoint is overridable.
 */
export function resolveChain() {
  const override = readEnv().GENLAYER_RPC_URL;
  const base = studioDevnet ?? studionet;
  if (!override) return base;
  if (override === base.rpcUrls.default.http[0]) return base;
  return {
    ...base,
    id: TARGET_CHAIN_ID,
    name: "GenLayer Studio Next",
    rpcUrls: { default: { http: [override] } },
  };
}

export function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const text = readFileSync(ENV_PATH, "utf8").replace(/^\uFEFF/, "");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Rewrite one key in `.env.local`, preserving everything else verbatim. */
export function writeEnv(updates) {
  const text = readFileSync(ENV_PATH, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const seen = new Set();

  const next = lines.map((line) => {
    const match = /^([A-Z0-9_]+)\s*=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  writeFileSync(ENV_PATH, next.join("\n"), "utf8");
}

export function requirePrivateKey() {
  const key = (readEnv().GENLAYER_PRIVATE_KEY ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "GENLAYER_PRIVATE_KEY is missing or malformed in .env.local. It must be 0x followed by 64 hex characters.",
    );
  }
  return key;
}

export function makeClient({ chain = resolveChain(), account } = {}) {
  const key = requirePrivateKey();
  return createClient({ chain, account: account ?? createAccount(key) });
}

export function requireAddresses() {
  const env = readEnv();
  const addresses = {
    decisionGate: (env.NEXT_PUBLIC_DECISION_GATE_ADDRESS ?? "").trim(),
    finalityVault: (env.NEXT_PUBLIC_FINALITY_VAULT_ADDRESS ?? "").trim(),
    scenarioRegistry: (env.NEXT_PUBLIC_SCENARIO_REGISTRY_ADDRESS ?? "").trim(),
  };
  const missing = Object.entries(addresses)
    .filter(([, value]) => !/^0x[0-9a-fA-F]{40}$/.test(value))
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `No deployed address for: ${missing.join(", ")}. Run \`npm run deploy\` first.`,
    );
  }
  return addresses;
}

/** Contract class name -> source file. Kept explicit so a rename cannot silently miss. */
export const CONTRACT_FILES = {
  ScenarioRegistry: "scenario_registry.py",
  FinalityVault: "finality_vault.py",
  DecisionGate: "decision_gate.py",
};

export function contractSource(name) {
  const file = CONTRACT_FILES[name];
  if (!file) throw new Error(`Unknown contract: ${name}`);
  const relative = path.join("contracts", file);
  const absolute = path.join(REPO_ROOT, relative);
  if (!existsSync(absolute)) throw new Error(`Contract source not found: ${relative}`);
  return readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
}

export function runnerRef(name) {
  const first = contractSource(name).split("\n")[0];
  const match = /"Depends"\s*:\s*"([^"]+)"/.exec(first);
  if (!match) throw new Error(`${name}: contract source does not declare a runner`);
  return match[1];
}

export function demoPolicyText() {
  const file = path.join(REPO_ROOT, "public", "demo", "policy-delivery-milestone-v3.txt");
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "").trimEnd();
}

export function demoEvidenceText(name = "delivery-742.txt") {
  const file = path.join(REPO_ROOT, "public", "demo", name);
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

export const log = {
  step: (message) => console.log(`\n== ${message}`),
  info: (message) => console.log(`   ${message}`),
  ok: (message) => console.log(`   OK  ${message}`),
  warn: (message) => console.log(`   !!  ${message}`),
  fail: (message) => console.error(`   XX  ${message}`),
};

/**
 * Price a state-changing transaction from the network's current fee policy.
 *
 * Studio Next requires a non-zero fee value on every state-changing
 * transaction (`FeeValueMustBeNonZero`). Rather than hard-coding a number the
 * network is free to change, the fee is quoted from the network itself at the
 * moment of use.
 */
export async function feeOptions(client, write, options = {}) {
  // A write that emits internal messages needs a fee allocation for each one.
  // The network rejects such a transaction with `fee no_matching_allocation`
  // unless the allocation tree is supplied.
  //
  // `options.messages` is the list of recipients the call is expected to emit
  // to. It is supplied by the caller, which is the only party that knows: the
  // network cannot tell us, because telling us would mean executing the call.
  const recipients = Array.isArray(options.messages) ? options.messages : [];

  if (write) {
    try {
      const simulated = await withRetry(() =>
        client.estimateTransactionFeesForWrite({
          address: write.address,
          functionName: write.functionName,
          args: write.args ?? [],
          ...(write.value === undefined ? {} : { value: write.value }),
        }),
      );
      const usable = recipients.length === 0 || (simulated.messageAllocations ?? []).length > 0;
      if (usable) {
        const fees = { distribution: simulated.distribution, feeValue: simulated.feeValue };
        if (simulated.messageAllocations) fees.messageAllocations = simulated.messageAllocations;
        lastGoodQuote = fees;
        return fees;
      }
    } catch {
      // Expected for a call that reverts, and for any call whose contract logic
      // reads chain time. Fall through and build the tree from the policy.
    }
  }

  try {
    const estimate = await withRetry(() => client.estimateTransactionFees());
    if (recipients.length) {
      const synthesised = synthesiseMessageFees(estimate, recipients);
      if (synthesised) {
        lastGoodQuote = synthesised;
        return synthesised;
      }
    }
    const fees = { distribution: estimate.distribution, feeValue: estimate.feeValue };
    if (estimate.messageAllocations) fees.messageAllocations = estimate.messageAllocations;
    lastGoodQuote = fees;
    return fees;
  } catch (error) {
    // The quote endpoint is the flakiest call on the network. A quote taken a
    // minute ago is still a valid, non-zero fee, and the chain charges actual
    // usage rather than the quote, so reusing one is safe.
    if (lastGoodQuote) return lastGoodQuote;
    throw error;
  }
}

/** Retry a read against the network. Quoting is the flakiest call we make. */
async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function formatGen(wei) {
  return `${Number(wei) / 1e18} GEN`;
}

export function shortHash(value, lead = 12, tail = 8) {
  const hash = String(value ?? "");
  if (hash.length <= lead + tail + 3) return hash;
  return `${hash.slice(0, lead)}...${hash.slice(-tail)}`;
}

export function explorerTx(hash) {
  const base = (readEnv().NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "https://explorer-studio-dev.genlayer.com").replace(/\/$/, "");
  return `${base}/tx/${hash}`;
}

export function explorerAddress(address) {
  const base = (readEnv().NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "https://explorer-studio-dev.genlayer.com").replace(/\/$/, "");
  return `${base}/address/${address}`;
}
