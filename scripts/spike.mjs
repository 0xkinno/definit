/**
 * Phase 0B mechanism spike.  EXPERIMENT CODE.
 *
 * Reproduces, from nothing, the measurements the v2 thesis stands on. Every
 * number written to docs/evidence/milestone/spike/ comes from the network.
 * Nothing here decides anything; it samples and records.
 *
 * The target network rate-limits at 500 requests per hour, so every call goes
 * through `pace`, sampling is sparse, and the request count is recorded.
 *
 * Usage:
 *   node scripts/spike.mjs setup
 *   node scripts/spike.mjs decide <method> <tag> [--fees N] [--appeal] [--interval S] [--tail S]
 *   node scripts/spike.mjs direct <tag>
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAccount, createClient } from "genlayer-js";
import { studioDevnet, studionet } from "genlayer-js/chains";

import { REPO_ROOT, readEnv, log } from "./_shared.mjs";

const OUT = process.env.SPIKE_OUT_DIR ? path.resolve(process.env.SPIKE_OUT_DIR) : path.join(REPO_ROOT, "docs", "evidence", "milestone", "spike");
export const NET = process.env.SPIKE_NET === "studionet" ? "studionet" : "studio-dev";
const BASE_CHAIN = NET === "studionet" ? studionet : studioDevnet;
const PREFIX = NET === "studio-dev" ? "" : `${NET}-`;
const STATE = path.join(OUT, `${PREFIX}state.json`);
const RPC = NET === "studionet" ? studionet.rpcUrls.default.http[0] : readEnv().GENLAYER_RPC_URL || studioDevnet.rpcUrls.default.http[0];
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const counter = { calls: 0, waitedMs: 0 };

/** Run a network call; on the hourly rate limit, sleep out the stated retry window and try again. */
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
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await response.json();
    if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), { cause: body.error });
    return body.result;
  });
}

/** The protocol lifecycle projection. The endpoint takes {txId}; the SDK wrapper sends {hash} (observation O1). */
export const lifecycle = (txId) => rpc("gen_getTransactionLifecycle", [{ txId }]);
export const getTx = (hash) => rpc("eth_getTransactionByHash", [hash]);

export function makeSpikeClient() {
  const key = readEnv().GENLAYER_PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("GENLAYER_PRIVATE_KEY missing in .env.local");
  const account = createAccount(key);
  const chain = { ...BASE_CHAIN, rpcUrls: { default: { http: [RPC] } } };
  return { client: createClient({ chain, account }), account };
}

const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const saveState = (s) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STATE, j(s));
};

/** A fee quote, or undefined on a network that has no fee surface (gasless Studio). Detected from the estimate, never from the network name. */
async function quote(client, options) {
  try {
    const est = await pace(() => client.estimateTransactionFees(options));
    return { est, fees: { distribution: est.distribution, feeValue: est.feeValue }, gasless: false };
  } catch (error) {
    return { est: null, fees: undefined, gasless: true, reason: String(error?.details ?? error?.message ?? error).slice(0, 160) };
  }
}

async function deploy(client, file, args) {
  const code = readFileSync(path.join(REPO_ROOT, "research", "spike", file), "utf8");
  const q = await quote(client);
  const hash = await pace(() => client.deployContract({ code, args, ...(q.fees ? { fees: q.fees } : {}) }));
  const receipt = await pace(() => client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 6000, retries: 60 }));
  const address = receipt?.data?.contract_address ?? receipt?.contract_address;
  if (!address) throw new Error(`${file}: no address (${receipt?.status_name})`);
  // Status alone is not success (v1 defect C6): a deploy can be ACCEPTED and still have executed with an error.
  const tx = await getTx(hash);
  if (tx.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(`${file}: deploy did not execute successfully: ${tx.status} / ${tx.txExecutionResultName}`);
  }
  return { address, hash, status: receipt.status_name, result: receipt.result_name, execution: tx.txExecutionResultName };
}

async function setup() {
  const { client, account } = makeSpikeClient();
  const balance = BigInt(await rpc("eth_getBalance", [account.address, "latest"]));
  if (balance < 10n ** 18n) await rpc("sim_fundAccount", [account.address, 1000 * 10 ** 18]);
  const sink = await deploy(client, "spike_sink.py", []);
  const judge = await deploy(client, "spike_judge.py", [sink.address]);
  saveState({ network: { name: NET, rpc: RPC, chainId: BASE_CHAIN.id }, sink, judge, deployedAt: new Date().toISOString() });
  log.ok(`sink ${sink.address} judge ${judge.address} (requests ${counter.calls})`);
}

const parseEntry = (line) => {
  const [stage, tag, sender, datetime, n] = String(line).split("|");
  return { stage, tag, sender: sender?.toLowerCase(), datetime, n: Number(n) };
};

async function readSink(client, address) {
  const raw = await pace(() => client.readContract({ address, functionName: "get_entries", args: [] }));
  return raw.map(parseEntry);
}

/**
 * Fee tree for a write that emits messages.
 *
 * The network requires one allocation per emitted message, keyed by the
 * recipient and the target method name (observation O8). A deterministic
 * method is simulated and the network returns the tree itself. A
 * non-deterministic method cannot be simulated, so its tree is synthesised from
 * a simulated sibling: same allocation shape, one entry per \`--msgs\` item
 * (\`method:accepted\` or \`method:finalized\`), each with a distinct key.
 * \`--fees 0\` underfunds on purpose (E4): the tree is built with a zero budget.
 */
async function buildFees(client, state, method, tag, argv, messageFees) {
  const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const wanted = val("--msgs", null);
  const tree = (est, allocations, budgetEach) => ({
    distribution: { ...est.distribution, totalMessageFees: budgetEach * BigInt(allocations.length) },
    feeValue: BigInt(est.feeValue) - BigInt(est.distribution.totalMessageFees) + budgetEach * BigInt(allocations.length),
    messageAllocations: allocations.map((a) => ({ ...a, budget: budgetEach })),
  });
  if (!wanted) {
    const sim = await pace(() => client.estimateTransactionFeesForWrite({ address: state.judge.address, functionName: method, args: [tag] }));
    const each = argv.includes("--fees") ? messageFees : BigInt(sim.observed?.recommendedTotalMessageFees ?? sim.distribution.totalMessageFees);
    return tree(sim, sim.messageAllocations ?? [], (sim.messageAllocations ?? []).length ? each : 0n);
  }
  const sibling = await pace(() => client.estimateTransactionFeesForWrite({ address: state.judge.address, functionName: "decide_fin", args: ["tpl"] }));
  const base = sibling.messageAllocations[0];
  const items = wanted.split(",").map((x) => x.split(":"));
  const allocations = items.map(([m, stage]) => ({
    ...base,
    onAcceptance: stage === "accepted",
    callKey: "0x" + Buffer.from(m).toString("hex").padEnd(64, "0"),
  }));
  const each = argv.includes("--fees") ? messageFees : BigInt(sibling.observed.recommendedTotalMessageFees);
  return tree(sibling, allocations, each);
}

/**
 * Submit one write and sample its protocol lifecycle every `--interval`
 * seconds. After the transaction reaches a terminal status, keep sampling for
 * `--tail` seconds so a late child message is not missed. Evidence is written
 * on every sample.
 */
async function decide(argv) {
  const [method, tag] = argv;
  const flag = (n) => argv.includes(n);
  const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const state = loadState();
  const { client } = makeSpikeClient();
  const messageFees = BigInt(val("--fees", "0"));
  const gaslessProbe = await quote(client);
  const fees = gaslessProbe.gasless ? undefined : await buildFees(client, state, method, tag, argv, messageFees);
  const est = { feeValue: fees?.feeValue ?? 0n };
  const t0 = Date.now();
  const hash = await pace(() => client.writeContract({ address: state.judge.address, functionName: method, args: [tag], value: 0n, ...(fees ? { fees } : {}) }));
  const record = {
    experiment: `decide:${method}`,
    tag,
    txHash: hash,
    submittedAtMs: t0,
    totalMessageFees: messageFees.toString(),
    feeValue: est.feeValue.toString(),
    gasless: gaslessProbe.gasless,
    gaslessReason: gaslessProbe.reason ?? null,
    samples: [],
    appeal: null,
  };
  const file = path.join(OUT, `${PREFIX}run-${tag}.json`);
  const intervalS = Number(val("--interval", 10));
  let terminalAt = null;
  let appealed = false;

  for (let i = 0; i < 120; i++) {
    const at = Date.now();
    let lc = await lifecycle(hash).catch((e) => ({ error: String(e.message ?? e) }));
    if (lc.error) {
      // No protocol lifecycle on this network (observation O9): fall back to the stored status, which is all it offers.
      const stored = await getTx(hash).catch(() => null);
      const name = String(stored?.status ?? "").toLowerCase();
      lc = { ...lc, projectedStatus: name ? name[0].toUpperCase() + name.slice(1) : undefined, fallback: "eth_getTransactionByHash.status" };
    }
    const sample = { atMs: at, lifecycle: lc };
    if (i % 3 === 2) sample.sinkCounter = await pace(() => client.readContract({ address: state.sink.address, functionName: "get_counter", args: [] })).catch(() => null);
    record.samples.push(sample);
    if (flag("--appeal") && !appealed && lc.projectedStatus === "Accepted") {
      appealed = true;
      try {
        const charge = await pace(() => client.getAppealCharge({ txId: hash }));
        const out = await pace(() => client.appealTransaction({ txId: hash, value: charge }));
        record.appeal = { atMs: Date.now(), charge: charge.toString(), result: typeof out === "string" ? out : j(out) };
      } catch (e) {
        record.appeal = { atMs: Date.now(), error: String(e.message ?? e).slice(0, 400) };
      }
    }
    if (!terminalAt && ["Finalized", "Canceled", "Undetermined"].includes(lc.projectedStatus)) terminalAt = at;
    writeFileSync(file, j(record));
    if (terminalAt && at - terminalAt > Number(val("--tail", 40)) * 1000) break;
    await sleep(intervalS * 1000);
  }

  const tx = await getTx(hash);
  record.finalTx = {
    status: tx.status,
    txExecutionResultName: tx.txExecutionResultName,
    triggered_transactions: tx.triggered_transactions,
    messages: tx.messages,
    fees: tx.fees?.distribution,
    latestDecision: tx.consensus_history?.latestDecision,
  };
  record.children = [];
  for (const child of tx.triggered_transactions ?? []) {
    const c = await getTx(child);
    record.children.push({
      hash: child,
      status: c.status,
      txExecutionResultName: c.txExecutionResultName,
      created_at: c.created_at,
      created_timestamp: c.created_timestamp,
      triggered_by: c.triggered_by,
      triggered_on: c.triggered_on,
      from_address: c.from_address,
      to_address: c.to_address,
      timestamp_awaiting_finalization: c.timestamp_awaiting_finalization,
    });
  }
  record.parentTimes = {
    created_at: tx.created_at,
    created_timestamp: tx.created_timestamp,
    timestamp_awaiting_finalization: tx.timestamp_awaiting_finalization,
    consensus_monitoring: tx.consensus_history?.consensus_results?.[0]?.monitoring,
  };
  record.sink = await readSink(client, state.sink.address).catch((e) => String(e.message ?? e));
  record.requests = counter.calls;
  writeFileSync(file, j(record));
  const delivered = Array.isArray(record.sink) ? record.sink.filter((x) => x.tag.startsWith(tag)).length : "n/a";
  log.ok(`${tag}: ${tx.status} / ${tx.txExecutionResultName}; sink entries ${delivered}; requests ${counter.calls}`);
}

/** E5 half: an EOA calls the sink directly, so its recorded sender can be compared with a delivered message's. */
async function direct(argv) {
  const state = loadState();
  const { client, account } = makeSpikeClient();
  const q = await quote(client);
  const hash = await pace(() =>
    client.writeContract({ address: state.sink.address, functionName: "record", args: ["direct", argv[0] ?? "e5"], value: 0n, ...(q.fees ? { fees: q.fees } : {}) }),
  );
  await pace(() => client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 6000, retries: 60 }));
  const entries = await readSink(client, state.sink.address);
  writeFileSync(path.join(OUT, `${PREFIX}e5-direct-${argv[0] ?? "e5"}.json`), j({ experiment: "E5-direct", eoa: account.address.toLowerCase(), txHash: hash, entries }));
  log.ok(`direct call recorded; requests ${counter.calls}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "setup") await setup();
  else if (cmd === "decide") await decide(rest);
  else if (cmd === "direct") await direct(rest);
  else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
  process.exit(0);
}
