# Limitations

A submission that claims everything proves nothing. This file states the edges
of what has been demonstrated, and what would show that the central claim is
wrong.

## What is not proven

- **That the final-scope read is a boundary we could use.** This is the largest
  limitation and it is not a design choice. The construction the whole design
  wants is a cross-contract read scoped to final storage state:
  `gl.contract.get_at(gate).view(state=gl.contract.StorageView.LATEST_FINALIZED)`.
  That call cannot execute on this network. It does not return a refusal, it
  stops returning at all, and the leader is killed with
  `Leader execution exceeded 600.000s`. The isolation run recorded in
  `artifacts/vm-capabilities.json` isolates it: a plain cross-contract read of
  the same method on the same contract answers in full, a message emitted on
  the finalized stage succeeds, a value transfer emitted on the finalized stage
  succeeds, and the final-scoped read never answers. The consequence is stated
  plainly in the next bullet.
- **That "final" in the deployed pair means consensus finality.** It does not,
  and calling it that would be dishonest. The boundary is enforced by two
  on-chain facts instead of by a read scope: the decision contract refuses to
  promote a decision until a recorded appeal window has closed
  (`APPEAL_WINDOW_OPEN`), and the vault re-derives that same window from the
  gate's own adjudication stamp and refuses to release before it has elapsed.
  Both contracts measure the window with the clock of the transaction doing the
  checking, so neither trusts the caller. That is a real boundary -- no value
  moves while the judgement is still contestable -- but it is an *elapsed-time*
  boundary, not a state-visibility boundary. A validator set that reverses a
  decision after the window has closed would not be caught by it.
- **That the corpus is exhaustive.** The thirteen cases in
  `tests/fixtures/cases.json` were derived by enumerating the ways an
  irreversible effect can be attached to a decision that is not yet final. They
  were written by hand. No fuzzer, symbolic executor or formal model was used
  to search for a case outside the set.
- **That one live run is statistical evidence.** The lifecycle in
  `artifacts/live-lifecycle.json` is a single successful end-to-end run. It
  demonstrates that the boundary exists on a real network under real consensus.
  It is not a measurement of failure rates, latency distributions, or validator
  behaviour under load.
- **That the fee path is a supported API.** The network's
  `sim_estimateTransactionFees` executes the call it is pricing, so it cannot
  price a call whose contract logic reads chain time -- which is exactly the
  promotion and the release. A fee tree for those calls therefore has to be
  built from the policy quote, with one allocation per emitted message and an
  encoded `feeParams` blob recorded once in `artifacts/fee-template.json` by
  `npm run fee-template`. This works, and the lifecycle proves it works, but it
  depends on a recorded blob rather than on a documented endpoint, and it would
  need re-recording if the network's fee policy changed.
- **That simulation reflects current chain time.** Related to the previous two:
  the fee simulation appears to execute against the last finalized snapshot, so
  a call guarded by elapsed time can never pass simulation. The tooling works
  around this rather than fixing it. This is an observation from the run, not a
  documented property of the network, and it may change.
- **That asset transfer semantics are general.** The demo moves the network's
  native test token. Contracts that move an ERC-20-style asset would need the
  same commitment comparison around a different transfer primitive, and that
  variant has not been exercised on chain.
- **That the adjudication prompt is optimal.** The evidence judgement is
  produced by an LLM under an equivalence principle. DEFINIT treats the verdict
  as an input and binds effects to the verdict's finality. It does not claim the
  verdict is correct.
- **That the app is deployed.** The contracts are deployed and the lifecycle is
  live. The web application runs locally and is proven to build; a public
  hosting deployment requires an operator account that this environment does
  not hold.

## What would falsify the claim

The central claim is: *an irreversible effect cannot be produced against a
decision that is still appealable.*

Any one of the following would falsify it.

1. **A settlement against a provisional decision.** A run in which the vault
   releases value while the decision contract still reports the decision as
   inside its appeal window, or while its state is not `FINALIZED`.
2. **A settlement that does not match the committed intent.** A release whose
   beneficiary, amount, policy hash, evidence digest or nonce differs from the
   values the gate recorded for that action.
3. **A second release for the same action.** Any path that produces two
   settlements from one commitment.
4. **A refusal of a legitimate settlement.** A run in which the interruption
   blocks a decision that has been promoted and whose window has closed. This
   would show the guard is not a guard but an outage.
5. **A promotion that succeeds inside the window.** The lifecycle attempts this
   on every run, on purpose. If it ever returns rather than reverting with
   `APPEAL_WINDOW_OPEN`, the boundary is gone.

The attack suite is written so that each of these is a named, executable case
rather than a paragraph.
