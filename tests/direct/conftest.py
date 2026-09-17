"""Direct-mode test configuration.

Installs the SDK-generation compatibility layer described in `_sdk_compat.py`
before any contract is deployed. Without it the published test runner looks for
the previous ``genlayer.py.*`` module paths and cannot load a contract written
against the current SDK.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

import _sdk_compat

_sdk_compat.install()


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def contracts_dir(repo_root: Path) -> Path:
    return repo_root / "contracts"
