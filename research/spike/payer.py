# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
import genlayer as gl
from genlayer import *


class Payer(gl.contract.Contract):
	n: u256

	def __init__(self):
		self.n = u256(0)

	@gl.public.write.payable
	def fund(self) -> None:
		self.n = u256(int(self.n) + 1)

	@gl.public.write
	def pay_fin(self, to: str, amount: int) -> None:
		gl.chain.Account(Address(to)).emit_transfer(value=u256(amount), on='finalized')

	@gl.public.write
	def pay_default(self, to: str, amount: int) -> None:
		gl.chain.Account(Address(to)).emit_transfer(value=u256(amount))
