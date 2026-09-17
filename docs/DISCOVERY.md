# DISCOVERY

What was read, what it says, and what follows from it. Every claim below is
traceable to a file in the GenVM or SDK source that was read directly, not to a
marketing page.

## Sponsor primitive

GenLayer transaction finality, combined with contract-to-contract messages that
are staged to execute on a chosen lifecycle step.

Two independent mechanisms are involved and they are often confused with each
other:

1. **Finality.** A transaction passes through a sequence of statuses. `ACCEPTED`
   means validators agreed on a leader's result. `FINALIZED` means the appeal
   window has closed without a successful challenge. Between those two points,
   the result is real, observable, and *reversible*.
2. **Message staging.** An outbound message emitted by a contract carries an
   explicit stage. `gl.contract.deploy(..., on: ON = 'finalized')` and
   `Proxy.emit(..., on='finalized')` defer delivery until the emitting
   transaction is final. `on='accepted'` delivers earlier.

## Observed constraint

A decision that has reached `ACCEPTED` is already readable by every other
contract, and a reader that does not ask for a specific storage scope gets the
decided-but-not-final answer.

## Evidence

**1. The SDK exposes an explicit storage-scope enum for cross-contract reads.**

```
gl.contract.Proxy.view(self, *, state: StorageView = StorageView.LATEST_DECIDED,
                       catch_vm_error: bool = False)
```

and

```
StorageView.DEFAULT = 0
StorageView.LATEST_FINALIZED = 1
StorageView.LATEST_DECIDED = 2
```

The default is `LATEST_DECIDED`. A consumer that does not pass `state=`
explicitly is therefore reading provisional data, by default, silently. This is
the single most important fact in the discovery: the unsafe behaviour is the
default behaviour.

*Read from the deployed SDK surface via `gen_getContractSchemaForCode` on Studio
Next, chain 61997, and from `genlayer/contract/__init__.py` in the runner
archive.*

**2. GenVM resolves a contract's runtime from a comment on line one.**

```
executor/src/runners/parse.rs::code_to_archive_from_text
executor/src/rt/supervisor/actions.rs::full_check_runner_uid
```

A contract whose first line is not a runner comment fails with
`invalid_contract absent_runner_comment`; one whose dependency cannot be resolved
fails with `invalid_contract malformed_runner`. Both were observed live before
the contracts were corrected. The practical consequence is that a deployment can
return a transaction hash, reach `FINALIZED`, and still have created nothing.

**3. The node publishes the runner it will actually use.**

Studio Next resolves `py-genlayer` to
`py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`, which pulls
`py-lib-genlayer-std:kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0` and
`cpython:3t4hs1eyrs8rb0qf538cbc227jskqeke9pfys0vaftapv91xn9v0`. The rejected
dependency hash is recorded in `docs/LIMITATIONS.md`.

**4. The interesting APIs are not where the documentation pattern suggests.**

On this SDK build, `TreeMap`, `DynArray` and `allow` live in
`genlayer.storage`; `StorageView` lives in `genlayer.contract`; `gen_getContractSchemaForCode`
compiles a contract without deploying it. The last one is used as the project's
pre-deployment gate (`scripts/validate-contracts.mjs`).

## Common failure

Applications flatten the lifecycle into a boolean. They ask "is the transaction
done?" and treat `ACCEPTED` as done. The flattening is invisible because the SDK's
default read scope agrees with it.

A second, quieter version of the same failure: an application that *is* careful
about timing but only checks the message stage. Staging alone is not sufficient,
because a staged message proves only that the transaction reached the stage it
was emitted on. It says nothing about whether the consumer's view of the world
was final at the moment it acted.

## New capability

**Finality-scoped execution.** An irreversible effect whose authorisation is a
storage read that is syntactically incapable of returning provisional data.

## Invariant

> No irreversible effect is produced from a decision until that decision has
> cleared its appeal window, the caller is authorised, the commitment matches
> exactly, the nonce is unused, and the deadline has not passed.

The primitive this was meant to be built on — a cross-contract read scoped to
`LATEST_FINALIZED` — does not execute on this network, so the deployed boundary
is the appeal window rather than the read scope. See `docs/LIMITATIONS.md`.

## Break case

The accepted path, plus an appeal, plus a duplicate delivery of the same
instruction, produce two effects from one authorisation. `tests/attacks/` drives
this directly: the control contract in `contracts/control/unsafe_release.py`
reads with the default scope, emits on `accepted`, and keeps no nonce, so it
loses funds three separate ways.

## Reproducible demo

`npm run lifecycle` runs one action end to end on chain 61997 and records, among
other things, the exact moment at which the two read scopes disagree. That
disagreement *is* the product: the provisional read returns the decision, the
final read does not, and only the second read is allowed to move money.

The result is written to `docs/evidence/live-lifecycle.json`.

## Pinned surface

| Item | Value | Where it came from |
| --- | --- | --- |
| Chain | `61997` (GenLayer Studio Next) | network probe reported by `npm run verify` |
| RPC | `https://studio-dev.genlayer.com/api` | SDK chain definition `studioDevnet` |
| Runner | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` | resolved by the node during a schema call |
| SDK | `genlayer-js` `2.0.0-rc.1` | `package.json` |
| VM build | `genvm v0.3.0-rc7` | reported in the node's execution log |
| Storage import | `from genlayer.storage import allow, Array, DynArray, TreeMap` | live introspection |
| Read scope enum | `gl.contract.StorageView` | live introspection |