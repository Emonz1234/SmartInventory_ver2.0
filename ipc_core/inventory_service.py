"""Local operational stock, changed atomically with the physical transaction journal."""


def quantity(db, item_id, bin_id):
    row = db.execute('SELECT quantity FROM item_locations WHERE item_id=? AND bin_id=?', (item_id, bin_id)).fetchone()
    return row[0] if row else 0


def validate(db, item_id, bin_id, delta, capacity):
    if quantity(db, item_id, bin_id) + delta < 0:
        raise ValueError('Insufficient local stock')
    total = db.execute('SELECT COALESCE(sum(quantity),0) FROM item_locations WHERE bin_id=?', (bin_id,)).fetchone()[0]
    if capacity and total + delta > capacity:
        raise ValueError('Local bin capacity exceeded')


def apply(db, item_id, bin_id, delta):
    if quantity(db, item_id, bin_id)+delta < 0:
        raise ValueError('Inventory conflict; physical evidence must be reconciled')
    db.execute('''INSERT INTO item_locations(item_id,bin_id,quantity) VALUES(?,?,?)
        ON CONFLICT(item_id,bin_id) DO UPDATE SET quantity=quantity+?''',
        (item_id, bin_id, delta, delta))


def overlay(db, revision):
    # Server snapshots are a baseline. Preserve physical changes not included in that revision.
    for tx in db.execute("SELECT * FROM local_transactions WHERE inventory_applied=1 AND (server_revision IS NULL OR server_revision>?) ORDER BY sequence", (revision,)).fetchall():
        apply(db, tx['product_id'], tx['location_id'], tx['quantity'] if tx['operation_type']=='PUT' else -tx['quantity'])
