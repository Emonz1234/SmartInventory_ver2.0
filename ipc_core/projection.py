"""Project the scoped read model to the retained local API tables in ONE transaction."""
import json

TABLES = {"cabinet": "cabinets", "rack": "racks", "shelf": "shelves", "bin": "bins", "item": "items", "stock": "item_locations"}


def project(db):
    records = [json.loads(row[0]) for row in db.execute("SELECT body FROM edge_records")]
    for table in reversed(list(TABLES.values())):
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
            db.execute(f'INSERT INTO "{table}" ({quoted}) VALUES({placeholders})', [data[n] for n in names])
