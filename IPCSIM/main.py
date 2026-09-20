"""Compatibility launcher for the shared edge application."""
from pathlib import Path
import sys
import os
os.environ.setdefault("DEVICE_TYPE", "IPCSIM")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if __name__ == '__main__':
    from ipc_core.launcher import main
    main('IPCSIM')
else:
    from ipc_core.api import app
