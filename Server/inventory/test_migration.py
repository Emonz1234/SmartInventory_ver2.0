import io
import sqlite3
import json
import tempfile
from contextlib import closing
from pathlib import Path
from django.test import TestCase
from django.core.management import call_command
from .models import Cabinet, Item, Stock, LegacyImport, Ledger


class MigrationTests(TestCase):
    def test_dry_run_and_idempotent_import_with_history_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/"source.db"
            with closing(sqlite3.connect(source)) as db, db:
                db.executescript('''
                    CREATE TABLE cabinets(id,cabinet_code,cabinet_name);
                    INSERT INTO cabinets VALUES(1,'C','Cabinet');
                    CREATE TABLE racks(id,cabinet_id,rack_code,rack_name);
                    INSERT INTO racks VALUES(1,1,'R-7','Rack');
                    CREATE TABLE shelves(id,rack_id,shelf_code,level_no);
                    INSERT INTO shelves VALUES(1,1,'S',1);
                    CREATE TABLE bins(id,shelf_id,bin_code,capacity);
                    INSERT INTO bins VALUES(1,1,'B',100);
                    CREATE TABLE items(id,item_code,item_name,unit);
                    INSERT INTO items VALUES(1,'I','Item','piece');
                    CREATE TABLE item_locations(id,item_id,bin_id,quantity);
                    INSERT INTO item_locations VALUES(1,1,1,12);
                    CREATE TABLE inventory_transactions(id,quantity);
                    INSERT INTO inventory_transactions VALUES(1,12);
                ''')
            mapping = Path(directory)/"addresses.json"
            mapping.write_text(json.dumps({"1":7}),encoding="utf-8")
            options = dict(domain="IPCSIM",prefix="legacy-",backup_dir=directory,rack_address_map=str(mapping),stdout=io.StringIO())
            call_command("import_legacy",str(source),**options)
            self.assertEqual(Cabinet.objects.count(),0)
            call_command("import_legacy",str(source),apply=True,**options)
            call_command("import_legacy",str(source),apply=True,**options)
            self.assertEqual(Cabinet.objects.count(),1)
            self.assertEqual(Stock.objects.get().quantity,12)
            self.assertEqual(Ledger.objects.count(),0)
            self.assertEqual(len(LegacyImport.objects.get().archive["inventory_transactions"]),1)
            self.assertIsNone(Cabinet.objects.get().device_id)
            self.assertEqual(Cabinet.objects.get().domain,"IPCSIM")
