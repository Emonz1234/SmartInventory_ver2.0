import os
import subprocess
import sys
from ipc_core.store import Store
from test_edge import snapshot


def test_process_death_during_apply_recovers_previous_revision(tmp_path):
    path = tmp_path / "crash.db"
    store = Store(path, "sim-a", "IPCSIM")
    store.apply(snapshot())
    code = '''
import os, sys
from ipc_core.store import Store
from ipc_core.protocol import envelope, checksum
s=Store(sys.argv[1],'sim-a','IPCSIM')
m=envelope('sim-a','IPCSIM','sync.full',dict(records=[],digest=checksum([]),count=1,index=0),dataset_id='sim-a',revision=2,sync_id='crash')
s.apply(m, lambda db: os._exit(17))
'''
    result = subprocess.run([sys.executable,"-c",code,str(path)])
    assert result.returncode == 17
    recovered = Store(path,"sim-a","IPCSIM")
    assert recovered.revision() == 1
    assert len(recovered.records()) == 1
    recovered.apply(snapshot(rev=2,records=[]))
    assert recovered.records() == []
