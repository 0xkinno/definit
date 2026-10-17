# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
EXPERIMENT CODE, NOT PRODUCT CODE. Phase 0B mechanism spike.

Several small write methods so each emit form can be measured on its own:

  decide        non-deterministic decision, then one finalized-stage message
  decide_fin    deterministic, finalized-stage message only
  decide_failchild  deterministic, finalized message to a method that always errors (E4b)
  decide_acc    deterministic, accepted-stage message only (no value argument)
  decide_acc_v  deterministic, accepted-stage message only (value argument)

The decision is deliberately tiny: the experiment is about when messages
arrive, not about what was decided.
"""

import genlayer as gl
from genlayer import *  # noqa: F401,F403


class SpikeJudge(gl.contract.Contract):
	sink: Address
	decisions: u256

	def __init__(self, sink_address: Address):
		self.sink = Address(sink_address)
		self.decisions = u256(0)

	def _count(self) -> None:
		self.decisions = u256(int(self.decisions) + 1)

	@gl.public.write
	def decide(self, tag: str) -> None:
		def leader_fn():
			return gl.nondet.exec_prompt(
				'Reply with exactly one word, YES or NO: is 2 + 2 equal to 4?'
			).strip().upper()[:3]

		def validator_fn(leader_result) -> bool:
			if not isinstance(leader_result, gl.vm.Return):
				return False
			mine = leader_fn()
			return mine.startswith('YES') == str(leader_result.calldata).startswith('YES')

		verdict = gl.vm.run_nondet_default(leader_fn, validator_fn)
		self._count()
		gl.contract.get_at(self.sink).emit(on='finalized').record_finalized(tag + ':' + str(verdict))

	@gl.public.write
	def decide_fin(self, tag: str) -> None:
		self._count()
		gl.contract.get_at(self.sink).emit(on='finalized').record_finalized(tag + ':YES')

	@gl.public.write
	def decide_failchild(self, tag: str) -> None:
		self._count()
		gl.contract.get_at(self.sink).emit(on='finalized').record_fail(tag + ':YES')

	@gl.public.write
	def decide_acc(self, tag: str) -> None:
		self._count()
		gl.contract.get_at(self.sink).emit(on='accepted').record_accepted(tag + ':YES')

	@gl.public.write
	def decide_acc_v(self, tag: str) -> None:
		self._count()
		gl.contract.get_at(self.sink).emit(value=u256(0), on='accepted').record_accepted(tag + ':YES')

	@gl.public.view
	def get_decisions(self) -> int:
		return int(self.decisions)
