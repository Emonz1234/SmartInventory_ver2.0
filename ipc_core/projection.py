"""Project the scoped read model to the retained local API tables in ONE transaction."""
import json

TABLES = {"cabinet": "cabinets", "rack": "racks", "shelf": "shelves", "bin": "bins", "item": "items", "stock": "item_locations"}


def project(db):
    records = [json.loads(row[0]) for row in db.execute("SELECT body FROM edge_records")]
    for table in reversed(list(TABLES.values())):
        if table == 'items':
            db.execute('DELETE FROM items WHERE id NOT IN (SELECT item_id FROM inventory_transactions)')
            db.execute('UPDATE items SET is_active=0')
        else:
            db.execute(f'DELETE FROM "{table}"')
    for kind, table in TABLES.items():
        columns = {row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
        for record in records:
            if record["kind"] != kind:
                continue
            data = record["data"]
            if not set(data) <= columns:
                raise ValueError("Unsupported projection columns")
            names = list(data)
            quoted = ','.join('"'+n+'"' for n in names)
            placeholders = ','.join('?' for _ in names)
            updates = ','.join(f'"{n}"=excluded."{n}"' for n in names if n != 'id')
            db.execute(f'INSERT INTO "{table}" ({quoted}) VALUES({placeholders}) ON CONFLICT(id) DO UPDATE SET {updates}', [data[n] for n in names])
    from ipc_core.inventory_service import overlay
    revision = db.execute('SELECT COALESCE(max(revision),0) FROM edge_revision').fetchone()[0]
    overlay(db, revision)
