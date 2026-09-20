/**
 * Fresh probe of the final-scope read.
 *
 * The repository said two different things about the same capability in two
 * different places. This settles it against the network that is deployed right
 * now, and writes down exactly what each read returned.
 *
 * Three reads are made against the same decision, and each one is timed:
 *
 *   ordinary         get_capability(decision_id)          -- the client default;
 *   latest-nonfinal  ... scoped to decided-but-not-final storage;
 *   latest-final     ... scoped to final storage.
 *
 * These are the same SDK calls the application makes, against the deployed
 * contracts. Nothing here is simulated.
 *
 * Usage:
 *
 *     node scripts/probe-final-scope.mjs
 *     node scripts/probe-final-scope.mjs --decision 0x...
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAccount, createClient } from "genlayer-js";

import { REPO_ROOT, log, readEnv, requireAddresses, requirePrivateKey, resolveChain } from "./_shared.mjs";

const OUT_PATH = path.join(REPO_ROOT, "docs", "evidence", "final-scope-probe.json");
const LIFECYCLE_PATH = path.join(REPO_ROOT, "docs", "evidence", "live-lifecycle.json");

/** Long enough that a working read finishes, short enough to bound a hang. */
const READ_TIMEOUT_MS = 180_000;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function asText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function classify(error) {
  const text = asText(error?.shortMessage ?? error?.message ?? error);
  return {
    message: text.slice(0, 2000),
    name: error?.name ?? null,
    code: error?.code ?? null,
    timedOut: /timeout|timed out|exceeded|aborted/i.test(text),
  };
}

/** Run one read, timed, with the outcome captured rather than thrown. */
async function timedRead(label, fn) {
  const startedAt = Date.now();
  let timer = null;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timeout after ${READ_TIMEOUT_MS} ms`)),
          READ_TIMEOUT_MS,
        );
      }),
    ]);
    return { read: label, ok: true, elapsedMs: Date.now() - startedAt, value, error: null };
  } catch (error) {
    return { read: label, ok: false, elapsedMs: Date.now() - startedAt, value: null, error: classify(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeDecision(client, gate, decisionId, note) {
  log.step(`${note}: ${decisionId}`);

  const ordinary = await timedRead("ordinary", () =>
    client.readContract({ address: gate, functionName: "get_capability", args: [decisionId] }),
  );
  const nonfinal = await timedRead("latest-nonfinal", () =>
    client.readContract({
      address: gate,
      functionName: "get_capability",
      args: [decisionId],
      transactionHashVariant: "latest-nonfinal",
    }),
  );
  const final = await timedRead("latest-final", () =>
    client.readContract({
      address: gate,
      functionName: "get_capability",
      args: [decisionId],
      transactionHashVariant: "latest-final",
    }),
  );

  for (const result of [ordinary, nonfinal, final]) {
    const exists = result.ok ? result.value?.exists === true : false;
    log.info(
      `${result.read.padEnd(16)} ok=${String(result.ok).padEnd(5)} exists=${String(exists).padEnd(5)} ${result.elapsedMs} ms` +
        (result.ok ? "" : `  ${result.error.message.slice(0, 130)}`),
    );
  }

  return { decisionId, note, ordinary, nonfinal, final };
}

async function main() {
  const env = readEnv();
  const addresses = requireAddresses(env);
  const chain = resolveChain();
  const rpc = chain.rpcUrls?.default?.http?.[0] ?? null;

  // A read-only client. The probe does not need to sign anything.
  const client = createClient({ chain });

  const operator = String(createAccount(requirePrivateKey()).address ?? "").toLowerCase();

  const wanted = [];
  const fromArgs = argValue("--decision");
  if (fromArgs) wanted.push({ id: fromArgs, note: "requested on the command line" });

  try {
    const record = JSON.parse(readFileSync(LIFECYCLE_PATH, "utf8").replace(/^\uFEFF/, ""));
    const id = record?.boundary?.decisionId ?? record?.decisionId;
    if (id && !wanted.some((item) => item.id === id)) {
      wanted.push({ id: String(id), note: "the recorded live run" });
    }
  } catch {
    // No record: discovery below will have to find one.
  }

  // Whatever the record says, ask the gate what it actually holds.
  try {
    const listed = await client.readContract({
      address: addresses.decisionGate,
      functionName: "list_actions_for",
      args: [operator],
    });
    const actionIds = Array.isArray(listed)
      ? listed.slice(-4).map((item) => String(item?.action_id ?? item))
      : [];
    for (const actionId of actionIds) {
      try {
        const action = await client.readContract({
          address: addresses.decisionGate,
          functionName: "get_action",
          args: [actionId],
        });
        const decisionId = action?.decision_id ? String(action.decision_id) : null;
        if (decisionId && !wanted.some((item) => item.id === decisionId)) {
          wanted.push({
            id: decisionId,
            note: `live action ${actionId.slice(0, 14)} in state ${action.state}`,
          });
        }
      } catch (error) {
        log.warn(`could not read action ${actionId}: ${classify(error).message.slice(0, 140)}`);
      }
    }
  } catch (error) {
    log.warn(`could not enumerate actions: ${classify(error).message.slice(0, 140)}`);
  }

  if (!wanted.length) {
    log.fail("no decision id was found to probe; pass one with --decision");
    process.exit(1);
  }

  const probes = [];
  for (const item of wanted) {
    probes.push(await probeDecision(client, addresses.decisionGate, item.id, item.note));
  }

  const verdict = {
    sdkOrdinaryRead: probes.some((p) => p.ordinary.ok),
    sdkNonfinalRead: probes.some((p) => p.nonfinal.ok),
    sdkFinalRead: probes.some((p) => p.final.ok),
  };

  const document = {
    generatedAt: new Date().toISOString(),
    source: "scripts/probe-final-scope.mjs",
    about:
      "A fresh probe of the GenLayer client final-scope read against the deployed contracts. It measures which read variants execute on this network and records the exact error when one does not.",
    network: { name: chain.name, chainId: chain.id, rpc },
    contracts: { decisionGate: addresses.decisionGate, finalityVault: addresses.finalityVault },
    timeoutMs: READ_TIMEOUT_MS,
    probes,
    verdict,
    scope: "client SDK read path only",
    contractScope: {
      note:
        "The shipped contracts do not perform a cross-contract read of DecisionGate scoped to final storage. The vault derives the appeal boundary from the gate's own adjudication stamp instead.",
      usesLatestFinalizedStorageView: false,
    },
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(document, null, 2) + "\n", "utf8");

  log.step("Verdict");
  log.info(`client ordinary read     ${verdict.sdkOrdinaryRead ? "executes" : "does not execute"}`);
  log.info(`client nonfinal read     ${verdict.sdkNonfinalRead ? "executes" : "does not execute"}`);
  log.info(`client final read        ${verdict.sdkFinalRead ? "executes" : "does not execute"}`);
  log.step("Artifacts");
  log.ok("docs/evidence/final-scope-probe.json");
}

await main();
