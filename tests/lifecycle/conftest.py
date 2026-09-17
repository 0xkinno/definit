"""Fixtures for the lifecycle suite.

The lifecycle suite is the one that has to run against a real network: the
whole subject is the difference between two storage scopes, and a unit test
cannot have that difference. It therefore runs on `glsim`, the local GenLayer
network, which implements the same submit/decide/finalise lifecycle and the
same deferred message stages as the hosted one.

    python -m pytest tests/lifecycle --network localnet
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import _gltest_compat  # noqa: E402
import _sdk_compat  # noqa: E402

# Two bridges are needed before any contract loads: the class-name bridge for
# the published runner's AST lookup, and the SDK bridge that resolves the
# runner build against the toolchain installed on this machine.
_gltest_compat.install()
_sdk_compat.install()

from tests.integration.helpers import DefinitNetwork  # noqa: E402


@pytest.fixture(scope="module")
def network() -> DefinitNetwork:
    from gltest import get_contract_factory

    return DefinitNetwork(get_contract_factory)


@pytest.fixture(scope="module")
def deployed(network: DefinitNetwork) -> DefinitNetwork:
    network.deploy_all()
    network.publish_demo_policy()
    return network
