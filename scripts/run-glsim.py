"""Start the local GenLayer network used by the integration suites.

`glsim` is the official local GenLayer network: the same transaction
lifecycle, the same consensus, cross-contract calls and post-message stages,
running on this machine with no funds and no external services.

This entry point exists for one reason. The published local toolchain
(`genlayer-test` 0.29.2) targets the previous SDK module layout, so it cannot
load a contract written against the current one. `tests/_sdk_compat.py`
bridges that gap for the test process; this wrapper installs the same bridge
inside the simulator process, which is a separate interpreter.

Usage:

    python scripts/run-glsim.py --port 4000 --no-browser --seed definit

Everything after the script name is passed straight through to `glsim`.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = REPO_ROOT / "tests"

for directory in (REPO_ROOT, TESTS_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import _sdk_compat  # noqa: E402

_sdk_compat.install()

from glsim.__main__ import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
