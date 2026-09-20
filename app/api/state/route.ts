import { NextResponse } from "next/server";

import {
  CHAIN_ID,
  CHAIN_NAME,
  DECISION_GATE_ADDRESS,
  FINALITY_VAULT_ADDRESS,
  RUNTIME_MODE,
  RPC_URL,
  SCENARIO_REGISTRY_ADDRESS,
} from "@/lib/config";
import { publicCapabilities } from "@/lib/runtime/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    product: "DEFINIT",
    mode: RUNTIME_MODE,
    chain: { id: CHAIN_ID, name: CHAIN_NAME, rpc: RPC_URL },
    contracts: {
      decisionGate: DECISION_GATE_ADDRESS || null,
      finalityVault: FINALITY_VAULT_ADDRESS || null,
      scenarioRegistry: SCENARIO_REGISTRY_ADDRESS || null,
    },
    operatorSigner: (await publicCapabilities()).operatorSigning,
    note: "This API constructs transactions and reads state. It owns no truth: the contracts do.",
  });
}
