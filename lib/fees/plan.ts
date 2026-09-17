/**
 * Fee planning for one write, independent of where it runs.
 *
 * `sim_estimateTransactionFees` prices a call by executing it. Two of the calls
 * this application sends cannot be executed on demand: the promotion, which is
 * expected to revert while its appeal window is still open, and the release,
 * whose contract logic reads chain time. Asking the network to price them by
 * simulation returns nothing usable.
 *
 * So the fee tree is built from the policy quote instead, carrying one
 * allocation for every internal message the call is known to emit. Only the
 * encoded `feeParams` blob is not derivable from a quote, so one blob is
 * recorded from the network into `artifacts/fee-template.json` by
 * `npm run fee-template` and carried here as a template.
 *
 * The template is injected rather than read, because this module runs in two
 * places that obtain it differently: the server reads the recorded file, and
 * the browser receives the copy bundled with the application.
 */

export interface WriteShape {
  address: string;
  functionName: string;
  args: unknown[];
  value?: bigint;
}

export interface BuiltFees {
  distribution: Record<string, unknown>;
  feeValue: bigint;
  messageAllocations?: Array<Record<string, unknown>>;
}

export interface MessageAllocationTemplate {
  messageType: number;
  onAcceptance: boolean;
  parentIndex: string | number;
  budget: string;
  feeParams: string;
}

export interface FeeTemplate {
  messageAllocation?: MessageAllocationTemplate;
  callKeyWildcard?: string;
}

interface FeeQuote {
  distribution: Record<string, unknown>;
  feeValue: bigint | string | number;
  messageAllocations?: Array<Record<string, unknown>>;
}

interface QuoteClient {
  estimateTransactionFees?: () => Promise<FeeQuote>;
  estimateTransactionFeesForWrite?: (input: Record<string, unknown>) => Promise<FeeQuote>;
}

function plain(quote: FeeQuote): BuiltFees {
  return {
    distribution: quote.distribution,
    feeValue: BigInt(quote.feeValue),
    ...(quote.messageAllocations ? { messageAllocations: quote.messageAllocations } : {}),
  };
}

/**
 * Build the fee tree for one write.
 *
 * `messages` is the recipient list of the internal messages the call emits.
 * The caller supplies it because the network cannot: the only way to discover
 * it would be to execute the call, which is exactly what does not work here.
 *
 * Returns `undefined` when nothing usable is available, so the caller can let
 * the SDK fall back to its own quoting rather than sending a broken tree.
 */
export async function planFees(
  client: QuoteClient,
  write: WriteShape,
  messages: string[] = [],
  template: FeeTemplate | null = null,
): Promise<BuiltFees | undefined> {
  if (typeof client.estimateTransactionFeesForWrite === "function") {
    try {
      const simulated = await client.estimateTransactionFeesForWrite({
        address: write.address,
        functionName: write.functionName,
        args: write.args,
        ...(write.value === undefined ? {} : { value: write.value }),
      });
      const allocations = simulated?.messageAllocations ?? [];
      if (simulated && (messages.length === 0 || allocations.length > 0)) {
        return plain(simulated);
      }
    } catch {
      // Expected for the calls this module exists to price.
    }
  }

  const allocation = template?.messageAllocation ?? null;
  if (
    typeof client.estimateTransactionFees !== "function" ||
    allocation === null ||
    template === null
  ) {
    return undefined;
  }

  const estimate = await client.estimateTransactionFees();
  if (messages.length === 0) return plain(estimate);

  const budget = BigInt(allocation.budget);
  const totalMessageFees = budget * BigInt(messages.length);
  return {
    distribution: { ...estimate.distribution, totalMessageFees },
    feeValue: BigInt(estimate.feeValue) + totalMessageFees,
    messageAllocations: messages.map((recipient) => ({
      messageType: allocation.messageType,
      onAcceptance: allocation.onAcceptance,
      parentIndex: BigInt(allocation.parentIndex),
      recipient,
      callKey: template.callKeyWildcard,
      budget,
      feeParams: allocation.feeParams,
    })),
  };
}
