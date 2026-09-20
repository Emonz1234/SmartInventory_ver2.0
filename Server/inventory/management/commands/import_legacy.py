import json
import sqlite3
from contextlib import closing
from pathlib import Path
from datetime import datetime, timezone
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from Server.inventory.models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, LegacyImport
from Server.inventory.services import refresh
from tools.backup_legacy import backup


class Command(BaseCommand):
    help = "Back up and inspect legacy SQLite. --apply imports a new namespace, never replays history."

    def add_arguments(self, parser):
        parser.add_argument("source")
        parser.add_argument("--domain", required=True, choices=["IPC", "IPCSIM"])
        parser.add_argument("--prefix", required=True)
        parser.add_argument("--backup-dir", default="backups")
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--rack-address-map", help="JSON object mapping legacy rack IDs to verified Serial addresses")

    def handle(self, **options):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        destination = Path(options["backup_dir"]) / f"legacy-{stamp}.sqlite3"
        report = backup(options["source"], destination)
        self.stdout.write(json.dumps(report, indent=2))
        addresses = json.loads(Path(options["rack_address_map"]).read_text(encoding="utf-8-sig")) if options.get("rack_address_map") else {}
        if not options["apply"]:
            self.stdout.write("Dry run: backup created; Server not modified.")
            return
        with closing(sqlite3.connect(destination)) as db:
            db.row_factory = sqlite3.Row
            archive = {t: [dict(r) for r in db.execute('SELECT * FROM "'+t.replace('"','""')+'"')] for t in report["counts"]}
        # Logical content digest is stable across SQLite backup layout changes.
        from ipc_core.protocol import checksum
        digest = checksum({"domain": options["domain"], "archive": archive})
        with transaction.atomic():
            devices = list(Device.objects.select_for_update().order_by("pk"))
            if LegacyImport.objects.filter(digest=digest).exists():
                self.stdout.write("Already imported; no changes.")
                return
            prefix = options["prefix"]
            cabinets, racks, shelves, bins, items = {}, {}, {}, {}, {}
            for row in archive.get("cabinets", []):
                cabinets[row["id"]] = Cabinet.objects.create(code=prefix+str(row["cabinet_code"]), name=row.get("cabinet_name") or "", domain=options["domain"])
            for row in archive.get("racks", []):
                try:
                    address = int(addresses.get(str(row["id"]), row["rack_code"]))
                    if address < 1:
                        raise ValueError("Address must be positive")
                except (ValueError, TypeError):
                    raise CommandError("Non-numeric rack_code; provide --rack-address-map with verified Serial addresses")
                racks[row["id"]] = Rack.objects.create(cabinet=cabinets[row["cabinet_id"]], address=address, name=row.get("rack_name") or "")
            for row in archive.get("shelves", []):
                shelves[row["id"]] = Shelf.objects.create(rack=racks[row["rack_id"]], code=row["shelf_code"], level=row.get("level_no") or 1)
            for row in archive.get("bins", []):
                bins[row["id"]] = Bin.objects.create(shelf=shelves[row["shelf_id"]], code=row["bin_code"], capacity=row.get("capacity") or 0)
            for row in archive.get("items", []):
                items[row["id"]] = Item.objects.create(code=prefix+row["item_code"], name=row["item_name"], unit=row["unit"], min_qty=row.get("min_qty") or 0, max_qty=row.get("max_qty") or 0)
            for row in archive.get("item_locations", []):
                if row["quantity"] < 0:
                    raise CommandError("Negative legacy inventory requires reconciliation")
                Stock.objects.create(item=items[row["item_id"]], bin=bins[row["bin_id"]], quantity=row["quantity"])
            LegacyImport.objects.create(digest=digest, domain=options["domain"], archive=archive)
            for device in devices:
                refresh(device)
        self.stdout.write("Imported master/inventory; historical rows archived, cabinets unassigned. Source unchanged.")
