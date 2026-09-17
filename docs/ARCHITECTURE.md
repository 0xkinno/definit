# ARCHITECTURE

Twelve parts, in the order a request travels through them.

## 1. DecisionGate

`contracts/decision_gate.py`

The decision side of the firewall. It owns four pieces of state: `actions`,
`decisions`, `agent_index` and `total_actions`. It is the only contract that can
instruct a release, and it can only do so by emitting a message the vault will
independently re-check.

Its public surface:

| Method | Kind | Purpose |
| --- | --- | --- |
| `create_action` | write | register a bounded proposal and derive its commitment |
| `request_adjudication` | write | run the leader/validator block and record the outcome |
| `finalize_decision` | write | promote a decision, but only after proving it is already final |
| `mark_held` | write | freeze an action whose preconditions cannot be met |
| `mark_settled` | write | reconcile local state after the vault releases |
| `get_action` | view | the action record |
| `get_decision` | view | the decision record |
| `get_capability` | view | the finality capability |
| `list_actions_for` | view | bounded per-agent index |
| `describe` | view | the contract's own mode, including its read scope |

## 2. Evidence evaluation

`_adjudicate` is the only non-deterministic region in the system. It does three
things inside one leader/validator block:

1. fetches the evidence snapshot over HTTPS;
2. normalises it (whitespace-collapsed, truncated to `MAX_EVIDENCE_CHARS`);
3. asks a model to classify the snapshot against the policy text.

Everything the contract later depends on is derived *inside* that block. The
evidence digest in particular cannot be supplied by a caller, because a caller
cannot pre-commit to a digest it has not fetched.

## 3. Equivalence Principle surface

The consensus surface is deliberately three fields wide:

```text
verdict        APPROVE | REJECT
reason_code    one of seven documented codes
evidence_digest keccak256(EVIDENCE_DOMAIN | normalised snapshot)
```

`confidence` is computed and stored but is **excluded** from the consensus
surface. Two independent models rarely agree on a number, and requiring them to
would make honest disagreement look like a protocol failure. The validator
function re-fetches the snapshot, re-derives the digest, and fails the round if
the digest does not match; only then does it compare verdict and reason code.

## 4. Transaction lifecycle

`lib/lifecycle/state.ts` and `lib/lifecycle/map.ts`.

The SDK's `TransactionStatus` enum is mapped onto a small number of
program-facing states. The mapping is exhaustive and typed, so adding an upstream
status is a compile error until it is classified. Four upstream statuses are
grouped as *in flight*; `ACCEPTED` and the five `APPEAL_*` statuses are grouped as
*provisional*; only `FINALIZED` is *final*. `CANCELED`, `UNDETERMINED`,
`VALIDATORS_TIMEOUT` and the leader-timeout statuses are *aborted* and create no
authority at all.

## 5. Commitment construction

`compute_intent_hash` in the gate, mirrored byte-for-byte in
`lib/commitments/commitment.ts`.

```text
DEFINIT-COMMITMENT-v1
|agent=<hex>
|recipient=<hex>
|amount=<decimal>
|asset=<symbol>
|policy_hash=<hex>
|evidence_digest=<hex>
|nonce=<decimal>
|deadline=<unix>
```

Field order is fixed, the separators are unambiguous, and the digest is the
keccak of the UTF-8 encoding of that exact string. The client recomputes it so
that an independent party can verify what was judged without asking DEFINIT.

## 6. Finality boundary

The boundary was designed to be enforced by a *read*, not by a status check:

```python
gl.contract.get_at(self.gate).view(
    state=gl.contract.StorageView.LATEST_FINALIZED
).get_capability(decision_id)
```

**That read does not execute on this network.** It is not refused: it stops
returning, and the leader is killed with `Leader execution exceeded 600.000s`.
It is therefore not the mechanism that ships. See `docs/LIMITATIONS.md` and
`artifacts/vm-capabilities.json` for the isolation run that establishes this.

The boundary that does ship is enforced by two on-chain facts, both of which the
vault re-checks itself rather than trusting the caller:

1. `DecisionGate.finalize_decision` refuses with `APPEAL_WINDOW_OPEN` until
   `now >= adjudicated_at + APPEAL_WINDOW_SECONDS`.
2. `FinalityVault.settle` re-derives that same window from the gate's own
   `adjudicated_at`, requires the capability state to be `FINALIZED` with a
   non-empty `finalized_at`, and matches every commitment field before any value
   moves.

Both contracts measure the window with the clock of the transaction doing the
checking. Neither reads the other at final storage scope. This is an
*elapsed-time* boundary rather than a *state-visibility* boundary, and the
difference matters: it stops a release while the judgement is contestable, but it
would not catch a validator set that reversed a decision after the window had
closed. That limitation is stated in full in `docs/LIMITATIONS.md`.

## 7. Contract-to-contract message

```python
(gl.contract.get_at(self.vault)
   .emit(value=u256(0), on='finalized')
   .settle(action_id, decision_id, intent_hash, policy_hash,
           evidence_digest, nonce, recipient_hex, amount))
```

Two things travel with the message: the *stage* it will be delivered on, and the
*complete commitment* the sender believes it is acting on. The vault treats both
as claims to be checked, not as facts.

## 8. FinalityVault

`contracts/finality_vault.py`

Custody. It owns `escrows`, `receipts`, `used_nonces`, `settlement_count` and
`blocked_count`. It has exactly one economically meaningful method, `settle`, and
`settle` has eight independent guards (see README). `blocked_count` increments
when a settlement is refused *because the decision was not final*, which makes
the firewall's work observable rather than invisible.

An escrow can only be opened for an action that already carries a commitment.
Funding an unjudged action is refused with `NOT_ADJUDICATED`, because the
commitment cannot exist before adjudication.

An escrow can only be opened by the action's own agent, and only for the exact
amount the action states. The funder therefore chooses one thing: how much value
to commit. It cannot choose the recipient, the amount, the policy or the deadline.

## 9. Settlement nonce

The nonce is part of the commitment, not a counter bolted on afterwards. On a
successful release the pair `(action_id, nonce)` is written to `used_nonces`
*before* the outbound transfer is emitted, so a replayed instruction finds the
escrow already closed and the nonce already spent. Two independent refusals, both
tested.

## 10. Receipt generation

`FinalityReceipt` is written inside the same transaction that releases value. It
records the action, the decision, every commitment field, the nonce, the amount,
the funder, the recipient, the observation window, the read scope used, the
message stage and the timestamp. It is stored, not merely emitted, so it can be
read back later without an indexer.

`lib/receipts/schema.ts` validates the shape and `app/receipts/[id]` renders it as
a printable document.

## 11. Frontend lifecycle adapter

`lib/genlayer/transactions.ts` wraps the SDK so that every read and write goes
through one place. It never invents a status: it forwards the SDK's status and
lets `lifecycle/map.ts` classify it. `lib/server/signer.ts` is the only module
that touches a private key, and it refuses to run at all unless
`DEFINIT_ALLOW_SERVER_SIGNING=true`.

## 12. Failure handling

Every refusal in both contracts is a `gl.vm.UserError.immediate` carrying a
stable machine-readable code. The codes are listed as constants at the top of
each contract file, and the API layer maps them to human sentences. There is no
path in either contract that returns a partial success, and no administrative
override in either contract.