"""Compatibility layer for the GenLayer integration runner.

`gltest` 0.29.2 (the current release) locates contract classes by walking the
AST for a class whose base is written ``gl.Contract``.

Contracts written against the current SDK declare the base as
``gl.contract.Contract`` -- the SDK's own documentation specifies that form,
and it is the only one that resolves at runtime. The runner therefore finds no
contract and raises ``FileNotFoundError`` before any test runs.

This module widens the two lookups to accept both spellings. It is a tooling
shim only: no contract source is rewritten to satisfy a linter, and no
behaviour changes.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Optional

_SKIP_DIRS = {".venv", "venv", "env", "build", "dist", "__pycache__", ".git"}


def _is_gl_contract_base(node: ast.AST) -> bool:
    """Accept ``gl.Contract`` and ``gl.contract.Contract``."""
    if not isinstance(node, ast.Attribute) or node.attr != "Contract":
        return False
    value = node.value
    if isinstance(value, ast.Name):
        return value.id == "gl"
    if isinstance(value, ast.Attribute):
        return value.attr == "contract" and isinstance(value.value, ast.Name) and value.value.id == "gl"
    return False


def _contract_class_names(tree: ast.AST) -> list[str]:
    return [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and any(_is_gl_contract_base(b) for b in node.bases)
    ]


def install() -> None:
    from gltest.artifacts import contract as artifacts

    if getattr(artifacts, "_definit_compat_installed", False):
        return

    def search_path_by_class_name(contracts_dir: Path, contract_name: str) -> Path:
        matches: list[Path] = []
        for file_path in contracts_dir.rglob("*"):
            if any(part in _SKIP_DIRS for part in file_path.parts):
                continue
            if file_path.suffix not in (".gpy", ".py"):
                continue
            try:
                tree = ast.parse(file_path.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError) as error:
                raise ValueError(f"Error reading file {file_path}: {error}") from error
            if contract_name in _contract_class_names(tree):
                matches.append(file_path)

        if not matches:
            raise FileNotFoundError(f"Contract {contract_name} not found at: {contracts_dir}")
        if len(matches) > 1:
            found = ", ".join(str(path) for path in matches)
            raise ValueError(
                f"Multiple contracts named '{contract_name}' found in contracts directory. "
                f"Found in files: {found}. Please ensure contract names are unique."
            )
        return matches[0]

    def extract_contract_name_from_file(file_path: Path) -> str:
        tree = ast.parse(file_path.read_text(encoding="utf-8"))
        names = _contract_class_names(tree)
        if not names:
            raise ValueError(f"No valid contract class found in {file_path}")
        return names[0]

    artifacts.search_path_by_class_name = search_path_by_class_name
    artifacts._extract_contract_name_from_file = extract_contract_name_from_file
    artifacts._definit_compat_installed = True
