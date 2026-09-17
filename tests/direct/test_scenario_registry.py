"""Direct-mode tests for the policy registry.

The registry exists to make one sentence true: the policy a decision was made
against cannot be edited afterwards. These tests hold that sentence to account.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = str(ROOT / "contracts" / "scenario_registry.py")

POLICY_TEXT = "R1. The evidence must name the purchase order."


def test_publish_then_read_returns_a_content_hash(direct_deploy):
    registry = direct_deploy(REGISTRY)
    published = registry.publish_policy("p-1", "1.0.0", "T", POLICY_TEXT)

    assert isinstance(published, str)
    assert published.startswith("0x")
    assert len(published) == 66

    record = registry.get_policy("p-1")
    assert record["exists"] is True
    assert record["policy_hash"] == published
    assert record["text"] == POLICY_TEXT
    assert registry.get_policy_hash("p-1") == published


def test_hash_is_over_the_text_not_the_id(direct_deploy):
    """Two ids, identical text, identical hash. The hash tracks content."""
    registry = direct_deploy(REGISTRY)
    first = registry.publish_policy("p-a", "1.0.0", "T", POLICY_TEXT)
    second = registry.publish_policy("p-b", "9.9.9", "Other", POLICY_TEXT)
    assert first == second


def test_changing_the_text_changes_the_hash(direct_deploy):
    registry = direct_deploy(REGISTRY)
    original = registry.publish_policy("p-1", "1.0.0", "T", POLICY_TEXT)
    revised = registry.publish_policy("p-2", "1.0.1", "T", POLICY_TEXT + " And more.")
    assert original != revised


def test_a_policy_id_can_only_be_published_once(direct_deploy, direct_vm):
    """There is no update path and no delete path. Re-publishing is refused."""
    registry = direct_deploy(REGISTRY)
    registry.publish_policy("p-1", "1.0.0", "T", POLICY_TEXT)

    with direct_vm.expect_revert("POLICY_ALREADY_PUBLISHED"):
        registry.publish_policy("p-1", "2.0.0", "T", POLICY_TEXT + " Edited.")


def test_empty_inputs_are_refused(direct_deploy, direct_vm):
    registry = direct_deploy(REGISTRY)
    with direct_vm.expect_revert("POLICY_EMPTY"):
        registry.publish_policy("", "1.0.0", "T", POLICY_TEXT)


def test_unknown_policy_is_an_explicit_absence(direct_deploy):
    registry = direct_deploy(REGISTRY)
    record = registry.get_policy("nope")
    assert record["exists"] is False
    assert record["reason_code"] == "POLICY_UNKNOWN"
    assert registry.get_policy_hash("nope") == ""
    assert registry.count() == 0


def test_catalogue_lists_what_was_published(direct_deploy):
    registry = direct_deploy(REGISTRY)
    registry.publish_policy("p-1", "1.0.0", "One", POLICY_TEXT)
    registry.publish_policy("p-2", "1.0.0", "Two", POLICY_TEXT + " Two.")

    listed = registry.list_policies()
    assert [row["policy_id"] for row in listed] == ["p-1", "p-2"]
    assert registry.count() == 2
