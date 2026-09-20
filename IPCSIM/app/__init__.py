"""Compatibility import path; implementation is owned by ipc_core.app."""
from pathlib import Path
import sys
import importlib
import importlib.abc
import importlib.util

root = Path(__file__).resolve().parents[2]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))
__path__ = [str(root / "ipc_core" / "app")]


class _SharedLoader(importlib.abc.Loader):
    def create_module(self, spec):
        return importlib.import_module("ipc_core." + spec.name)

    def exec_module(self, module):
        pass


class _SharedFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith("app."):
            canonical = importlib.util.find_spec("ipc_core." + fullname)
            if canonical:
                return importlib.util.spec_from_loader(fullname, _SharedLoader(), is_package=canonical.submodule_search_locations is not None)
        return None


if __name__ == "app":
    sys.meta_path.insert(0, _SharedFinder())
