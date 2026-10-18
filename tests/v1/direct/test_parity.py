"""The parity corpus is current: regenerating it from the Python side yields the committed file."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_parity_vectors_are_current():
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen-parity-vectors.py"), "--check"], capture_output=True)
    assert result.returncode == 0, "tests/v1/fixtures/parity-vectors.json is stale; run scripts/gen-parity-vectors.py"
