"""Online SQLite backup; never copy a live .db without its WAL."""
import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from datetime import datetime, timezone


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError("Backup destination must be a new file")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source.as_uri()+"?mode=ro", uri=True)) as src:
        if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Source integrity check failed")
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)
            tables = [r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            counts = {t: dst.execute('SELECT count(*) FROM "'+t.replace('"', '""')+'"').fetchone()[0] for t in tables}
            if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Backup integrity check failed")
    report = {"source": str(source), "backup": str(destination), "counts": counts,
              "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "created_at": datetime.now(timezone.utc).isoformat()}
    destination.with_suffix(destination.suffix+".json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    print(json.dumps(backup(args.source, args.destination), indent=2))
