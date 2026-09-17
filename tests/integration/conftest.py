"""Shared fixtures for integration tests.

These tests talk to a real GenLayer node. By default that is `glsim`, the
official local GenLayer network, which runs the same consensus lifecycle --
submit, decide, accept, finalise -- and the same cross-contract messaging, at
no cost and deterministically.

    python -m glsim --port 4000 --no-browser --seed definit
    python -m pytest tests/integration

Point the same suite at the deployment target with:

    python -m pytest tests/integration --network studionet
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
