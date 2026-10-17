# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""EXPERIMENT CODE. Ten-line probe used by scripts/probe-network.mjs to learn
whether a network accepts the pinned runner and executes a contract."""

import genlayer as gl
from genlayer import *  # noqa: F401,F403


class Probe(gl.contract.Contract):
	value: u256

	def __init__(self):
		self.value = u256(1)

	@gl.public.view
	def get_value(self) -> int:
		return int(self.value)
