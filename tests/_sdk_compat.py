"""Compatibility layer between the direct-mode runner and the SDK generation
the contracts are written against.

Background
----------
The contracts declare::

    # { "Depends": "py-genlayer:1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh" }

That runner is built on the current ``genlayer`` package layout, where the SDK
is exposed as:

    genlayer.contract      genlayer.types      genlayer.storage
    genlayer.calldata      genlayer.nondet     genlayer.vm

The published direct-mode test runner (``genlayer-test`` 0.29.2, the current
release) was written against the previous layout, where the same code lived
under a ``genlayer.py`` prefix::

    genlayer.py.types      genlayer.py.storage      genlayer.py.calldata

The message schema and the calldata encoding are identical between the two
generations -- only the module paths moved. This module installs ``genlayer.py``
as an alias of the current package, so the runner drives the real current SDK
instead of a substituted one.

Nothing here changes contract behaviour. It is a module-path alias.
"""

from __future__ import annotations

import os
import re
import sys
import tarfile
import types
import tempfile
import importlib
import importlib.abc
import importlib.util
from pathlib import Path
from typing import Any, Optional

_ALIAS = "genlayer.py"


class _AliasLoader(importlib.abc.Loader):
    """Loader that hands back an already-imported module under another name."""

    def __init__(self, module: Any) -> None:
        self._module = module

    def create_module(self, spec: Any) -> Any:
        return self._module

    def exec_module(self, module: Any) -> None:
        return None


class _GenlayerPyFinder(importlib.abc.MetaPathFinder):
    """Resolve ``genlayer.py`` and ``genlayer.py.*`` onto the current layout.

    A finder is used rather than only a sys.modules entry because the runner
    evicts SDK modules between VM activations. Without this, a later
    ``from genlayer.py import calldata`` inside the runner fails even though the
    alias was installed earlier.
    """

    marker = "_definit_genlayer_py_alias"

    def find_spec(self, fullname: str, path: Any = None, target: Any = None) -> Any:
        if fullname != _ALIAS and not fullname.startswith(_ALIAS + "."):
            return None

        real_name = "genlayer" + fullname[len(_ALIAS):]
        try:
            real = importlib.import_module(real_name)
        except ImportError:
            return None

        sys.modules[fullname] = real
        return importlib.util.spec_from_loader(fullname, _AliasLoader(real))


def _install_sdk_aliases() -> bool:
    """Point ``genlayer.py.*`` at the current module layout."""
    try:
        import genlayer
        import genlayer.calldata
        import genlayer.types
        import genlayer.storage
        import genlayer.storage._internal
        import genlayer.storage._internal.generate
    except ImportError:
        return False

    alias = types.ModuleType(_ALIAS)
    alias.__doc__ = "Alias of the current genlayer package layout."

    pairs = (
        (f"{_ALIAS}.calldata", genlayer.calldata),
        (f"{_ALIAS}.types", genlayer.types),
        (f"{_ALIAS}.storage", genlayer.storage),
        (f"{_ALIAS}.storage._internal", genlayer.storage._internal),
        (f"{_ALIAS}.storage._internal.generate", genlayer.storage._internal.generate),
    )

    for name, module in pairs:
        sys.modules[name] = module
        setattr(alias, name.rsplit(".", 1)[-1], module)

    sys.modules[_ALIAS] = alias
    setattr(genlayer, "py", alias)
    return True


_RUNNER_DEPENDENCY = "py-genlayer"


def _local_cache_dir() -> Path:
    """Where the toolchain keeps its downloaded GenVM releases.

    The test runner relocates HOME into the repository so that nothing is
    written to a user profile the sandbox may not allow, which is why the
    repository-local location is checked as well rather than trusting HOME.
    """
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or str(Path.home())
    candidates = [
        Path(home) / ".cache" / "gltest-direct",
        Path(__file__).resolve().parents[1] / ".gltest-home" / ".cache" / "gltest-direct",
        Path.home() / ".cache" / "gltest-direct",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def discover_local_runner_hash() -> Optional[str]:
    """The py-genlayer build the toolchain on *this machine* actually ships.

    The hosted network and the locally cached GenVM release resolve the same
    dependency name to different content hashes. A contract that pins the
    network's hash cannot start locally, and a contract that pins the local
    hash is not what the deployment needs. The pinned hash therefore stays on
    disk as the network resolved it, and the local bridge resolves the copy it
    hands to the runner.

    Memoised beside the runner cache so a test run does not walk a 130 MB
    archive on every contract load.
    """
    override = os.environ.get("DEFINIT_LOCAL_RUNNER_HASH")
    if override:
        return override.strip()

    cache = _local_cache_dir()
    memo = cache / "local-runner-hash"
    if memo.exists():
        cached = memo.read_text(encoding="utf-8").strip()
        if cached:
            return cached

    tarballs = sorted(cache.glob("genvm-universal-*.tar.xz"))
    if not tarballs:
        return None

    try:
        with tarfile.open(tarballs[-1], "r:xz") as tar:
            members = [
                member.name
                for member in tar.getmembers()
                if member.name.startswith("runners/" + _RUNNER_DEPENDENCY + "/")
                and member.name.endswith(".tar")
            ]
    except Exception:
        return None

    if not members:
        return None

    parts = sorted(members)[-1].split("/")
    discovered = parts[-2] + parts[-1].replace(".tar", "")
    try:
        cache.mkdir(parents=True, exist_ok=True)
        memo.write_text(discovered, encoding="utf-8")
    except OSError:
        pass
    return discovered


def _reresolve_runner(source: str, runner_hash: str) -> str:
    """Point a contract's runner declaration at a build available here."""
    pattern = re.compile(
        r'("Depends"\s*:\s*"' + re.escape(_RUNNER_DEPENDENCY) + r':)([^"]+)(")'
    )
    return pattern.sub(
        lambda match: match.group(1) + runner_hash + match.group(3), source
    )


def _local_runner_copy(path: Any) -> Any:
    """A copy of `path` whose runner declaration resolves on this machine."""
    try:
        path = Path(path)
    except TypeError:
        return path
    if not path.exists():
        return path

    runner_hash = discover_local_runner_hash()
    if not runner_hash:
        return path

    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return path

    rewritten = _reresolve_runner(source, runner_hash)
    if rewritten == source:
        return path

    mirror = _local_cache_dir() / "contracts-local" / path.name
    try:
        mirror.parent.mkdir(parents=True, exist_ok=True)
        mirror.write_text(rewritten, encoding="utf-8", newline="\n")
    except OSError:
        return path
    return mirror


def _install_local_runner_bridge() -> None:
    """Resolve the runner dependency against the local toolchain.

    Deployments built through the contract factory carry their source as
    calldata, so the bridge rewrites the code on its way out. Direct-mode runs
    hand the runner a *path* instead, so the same rewrite is applied to a copy
    of the file. Both paths are inert when the declared hash already resolves.
    """
    from gltest.artifacts import contract as artifacts_contract

    original = artifacts_contract.compute_contract_code
    if getattr(original, "_definit_runner_bridge", False):
        return

    def compute_contract_code(main_file_path: Any, runner_file_path: Any = None) -> Any:
        code = original(main_file_path, runner_file_path)
        if isinstance(code, str):
            runner_hash = discover_local_runner_hash()
            if runner_hash:
                return _reresolve_runner(code, runner_hash)
        return code

    compute_contract_code._definit_runner_bridge = True  # type: ignore[attr-defined]
    artifacts_contract.compute_contract_code = compute_contract_code

    try:
        from gltest import artifacts as artifacts_package

        artifacts_package.compute_contract_code = compute_contract_code
    except Exception:
        pass


def install() -> None:
    """Wire the test runner onto the SDK generation the contracts target."""
    import gltest.direct.loader as loader
    import gltest.direct.sdk_loader as sdk_loader
    import gltest.direct.vm as vm_module
    import gltest.direct.wasi_mock as wasi_mock

    if getattr(loader, "_definit_compat_installed", False):
        return

    _install_finder()

    original_setup = sdk_loader.setup_sdk_paths

    def setup_sdk_paths(*args: Any, **kwargs: Any):
        # Direct-mode runs hand the runner a file path rather than source, so
        # the runner declaration has to be resolved on the file itself.
        forwarded = list(args)
        if forwarded:
            forwarded[0] = _local_runner_copy(forwarded[0])
        elif "contract_path" in kwargs:
            kwargs["contract_path"] = _local_runner_copy(kwargs["contract_path"])
        paths = original_setup(*forwarded, **kwargs)
        _install_sdk_aliases()
        return paths

    # The published loader does `from .sdk_loader import setup_sdk_paths`
    # inside its own function body, so it resolves the name from *this*
    # module at call time. Replacing the attribute on `loader` alone leaves
    # the real call site untouched and the runner declaration is never
    # re-resolved. Both attributes are set so neither route is missed.
    sdk_loader.setup_sdk_paths = setup_sdk_paths
    loader.setup_sdk_paths = setup_sdk_paths

    if os.name == "nt":
        _install_windows_fd0_shim(loader, vm_module)

    _install_storage_allocator(loader, vm_module)
    _install_user_error_handler(wasi_mock)
    _install_single_contract_registry_reset(loader)
    _install_schema_class_resolution()
    _install_local_runner_bridge()

    loader._definit_compat_installed = True


def _install_finder() -> None:
    finder = _GenlayerPyFinder()
    if not any(getattr(f, "marker", None) == finder.marker for f in sys.meta_path):
        sys.meta_path.insert(0, finder)


def _install_user_error_handler(wasi_mock: Any) -> None:
    """Surface ``gl.vm.UserError.immediate`` as a test-visible revert.

    A contract rejects a call by importing ``{"UserError": reason}`` through the
    WASI bridge, which aborts the current execution inside the real VM. The
    runner has no branch for that import, so the SDK's own ``assert False``
    fires afterwards and the reason string is lost.

    Translating the import into the runner's revert exception keeps the reason,
    and ``direct_vm.expect_revert("<CODE>")`` matches on it.
    """

    class ContractUserError(wasi_mock.ContractRollback):
        """A rejection raised by contract code, not by an explicit rollback."""

    original = wasi_mock._handle_gl_call

    def handle_gl_call(vm: Any, request: Any) -> Any:
        if isinstance(request, dict) and "UserError" in request:
            print(f"[compat] UserError intercepted: {request['UserError']!r}", flush=True)
            raise ContractUserError(str(request["UserError"]))
        return original(vm, request)

    wasi_mock.ContractUserError = ContractUserError
    wasi_mock._handle_gl_call = handle_gl_call


def _install_storage_allocator(loader: Any, vm_module: Any) -> None:
    """Allocate contract storage using the current builder signature.

    The runner allocates a contract instance by calling
    ``_storage_build(contract_cls, {})``. The current SDK takes a builder
    context instead -- ``_storage_build(_BuilderCtx.empty(), contract_cls)`` --
    and no longer exposes the ``Lit`` sentinel the runner tests against. The
    effect of the two versions is the same: build the type descriptor for the
    contract class, materialise an instance on the VM's storage manager, and
    call the storage-generated ``__init__``.
    """

    def allocate_contract(contract_cls: Any, vm: Any, *args: Any, **kwargs: Any) -> Any:
        from genlayer.storage import ROOT_SLOT_ID
        from genlayer.storage._internal.generate import (
            ORIGINAL_INIT_ATTR,
            _BuilderCtx,
            _storage_build,
        )

        type_desc = _storage_build(_BuilderCtx.empty(), resolve_contract_class(contract_cls))

        slot = vm._storage.get_store_slot(ROOT_SLOT_ID)
        instance = type_desc.get(slot, 0)

        init = getattr(type_desc, "cls", None)
        if init is None:
            init = getattr(contract_cls, "__init__", None)
        else:
            init = getattr(init, "__init__", None)

        if init is not None:
            if hasattr(init, ORIGINAL_INIT_ATTR):
                init = getattr(init, ORIGINAL_INIT_ATTR)
            init(instance, *args, **kwargs)

        return instance

    loader._allocate_contract = allocate_contract


def _install_windows_fd0_shim(loader: Any, vm_module: Any) -> None:
    """Defer the stdin temp-file unlink to VM teardown.

    Upstream replaces file descriptor 0 with a temporary file and then unlinks
    that file while the descriptor is still open. POSIX permits this; Windows
    does not, and raises WinError 32 before any test body runs.
    """

    def inject_message_to_fd0(vm: Any) -> None:
        try:
            from genlayer import calldata
            from genlayer.types import Address
        except ImportError:
            return

        sender_addr = vm.sender
        if isinstance(sender_addr, bytes):
            sender_addr = Address(sender_addr)

        contract_addr = vm._contract_address
        if isinstance(contract_addr, bytes):
            contract_addr = Address(contract_addr)

        origin_addr = vm.origin
        if isinstance(origin_addr, bytes):
            origin_addr = Address(origin_addr)

        message_data = {
            "contract_address": contract_addr,
            "sender_address": sender_addr,
            "origin_address": origin_addr,
            "stack": [],
            "value": vm._value,
            "datetime": vm._datetime,
            "is_init": False,
            "chain_id": vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }

        encoded = calldata.encode(message_data)

        fd, path = tempfile.mkstemp()
        try:
            os.write(fd, encoded)
            os.lseek(fd, 0, os.SEEK_SET)
            vm._original_stdin_fd = os.dup(0)
            os.dup2(fd, 0)
        finally:
            os.close(fd)

        vm._definit_stdin_path = path

    original_cleanup = vm_module.VMContext._cleanup_after_deactivate

    def cleanup_after_deactivate(self: Any) -> None:
        original_cleanup(self)
        path = getattr(self, "_definit_stdin_path", None)
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
            self._definit_stdin_path = None

    loader._inject_message_to_fd0 = inject_message_to_fd0
    vm_module.VMContext._cleanup_after_deactivate = cleanup_after_deactivate
_REGISTRY_MODULES = ("genlayer.gl.genvm_contracts", "genlayer.contract")
_REGISTRY_ATTRS = ("__known_contact__", "__known_contract__")


def reset_contract_registry() -> None:
    """Clear the SDK "one Contract subclass per module" global.

    The SDK records the first ``Contract`` subclass it ever sees in a
    module-level global and rejects any later subclass in the same process.
    Between deployments that global has to go back to ``None``.

    Two module paths are cleared because the layout moved between SDK
    generations: ``genlayer.gl.genvm_contracts`` in the older one,
    ``genlayer.contract`` in the current one.
    """
    for module_name in _REGISTRY_MODULES:
        module = sys.modules.get(module_name)
        if module is None:
            continue
        for attr in _REGISTRY_ATTRS:
            if hasattr(module, attr):
                setattr(module, attr, None)


def _install_single_contract_registry_reset(loader: Any) -> None:
    """Reset the registry before every contract load.

    The published local network (``glsim``) resets the registry itself, but it
    looks the module up under its older name only, so a second deployment in
    the same process is rejected before the contract body runs. Resetting at
    the loader boundary covers both the local network and the direct runner,
    and is a no-op when the registry is already clear.
    """
    original = loader.load_contract_class
    if getattr(original, "_definit_registry_reset", False):
        return

    def load_contract_class(*args: Any, **kwargs: Any) -> Any:
        reset_contract_registry()
        return original(*args, **kwargs)

    load_contract_class._definit_registry_reset = True  # type: ignore[attr-defined]
    loader.load_contract_class = load_contract_class

    try:
        from glsim import engine as glsim_engine
    except ImportError:
        return

    glsim_engine.SimEngine._reset_contract_registry = staticmethod(
        reset_contract_registry
    )


def resolve_contract_class(cls: Any) -> Any:
    """Return the declared contract class for a possibly synthesised one.

    The local network allocates a contract instance and then caches
    ``type(instance)``. For a storage-backed contract that object is the
    generated storage class, not the class written in the source file. It
    carries the original name and module but none of the declared methods, so
    anything that inspects it -- the deployment allocator, the ABI extractor --
    sees an empty contract.

    The declared class is still reachable: the loader registers the contract
    module under the generated class's ``__module__``, and the original name is
    bound there. Resolving through it is a no-op for a class that is already
    the declared one.
    """
    module_name = getattr(cls, "__module__", None)
    if not isinstance(module_name, str):
        return cls

    module = sys.modules.get(module_name)
    if module is None:
        return cls

    declared = getattr(module, getattr(cls, "__name__", ""), None)
    if isinstance(declared, type) and declared is not cls:
        return declared
    return cls


def _install_schema_class_resolution() -> None:
    """Make the local network describe the declared contract, not its shadow.

    Two caches hold the synthesised class, and both feed the ABI the test
    client builds its callable methods from. When the ABI comes back empty the
    client has no ``set_gate``, no ``settle`` and no way to prove anything, so
    the extraction is pinned to the declared class.
    """
    try:
        from glsim import engine as glsim_engine
    except ImportError:
        return

    engine = glsim_engine.SimEngine

    original_sdk_schema = engine._extract_sdk_schema

    def _extract_sdk_schema(self: Any, cls: Any) -> Any:
        schema = original_sdk_schema(self, cls)
        if schema.get("methods"):
            return schema
        declared = resolve_contract_class(cls)
        if declared is cls:
            return schema
        return original_sdk_schema(self, declared)

    engine._extract_sdk_schema = _extract_sdk_schema

    original_schema = getattr(engine, "_extract_schema", None)
    if original_schema is not None:

        def _extract_schema(self: Any, cls: Any) -> Any:
            return original_schema(self, resolve_contract_class(cls))

        engine._extract_schema = _extract_schema
