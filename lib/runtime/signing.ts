/**
 * How a step will be signed, derived from the runtime capability flags.
 *
 * This is a pure function with no imports, so the browser and the server read
 * the same rule and a test can read it too. It exists because the alternative
 * -- each component deciding for itself whether an operator exists -- is how a
 * page ends up offering a button that the route behind it refuses.
 *
 * The three states are deliberate and mutually exclusive:
 *
 *   wallet            a connected wallet will sign every step;
 *   operator          no wallet, and this host really does hold a signer;
 *   wallet-required   no wallet, and no signer -- live writes are impossible.
 *
 * Only `wallet-required` disables the live controls. It never offers the
 * operator path as a consolation, because there is no operator path.
 */

export type SigningStateKey = "wallet" | "operator" | "wallet-required";

export interface SigningStateInput {
  /** A browser wallet is connected, on the right chain, with an account. */
  walletReady: boolean;
  /** The deployment resolved a usable operator signer at request time. */
  operatorSigning: boolean;
}

export interface SigningState {
  key: SigningStateKey;
  title: string;
  detail: string;
  /** False means every live write control must be disabled. */
  liveActionsEnabled: boolean;
  /** What a disabled control says instead of "Run". */
  disabledLabel: string;
  /** How a completed step describes its signature. */
  pathwayLabel: string;
}

export function signingState({ walletReady, operatorSigning }: SigningStateInput): SigningState {
  if (walletReady) {
    return {
      key: "wallet",
      title: "Ready to sign",
      detail: "Every step will be signed by your connected wallet.",
      liveActionsEnabled: true,
      disabledLabel: "Run",
      pathwayLabel: "signed by your wallet",
    };
  }

  if (operatorSigning) {
    return {
      key: "operator",
      title: "Operator signing active",
      detail: "No wallet is connected. The hosted demo operator will sign the testnet transaction.",
      liveActionsEnabled: true,
      disabledLabel: "Run",
      pathwayLabel: "signed by the operator key",
    };
  }

  return {
    key: "wallet-required",
    title: "Wallet required for live actions",
    detail:
      "This public deployment does not hold a signing key. Connect a Studio Next wallet to run live transactions. You can still replay the recorded on-chain run below without a wallet.",
    liveActionsEnabled: false,
    disabledLabel: "Connect wallet to run",
    pathwayLabel: "signed by your wallet",
  };
}

/** True when at least one signing pathway actually exists. */
export function liveActionsEnabled(input: SigningStateInput): boolean {
  return signingState(input).liveActionsEnabled;
}
