import json
import logging
import os
import time
import threading
from datetime import timedelta
from django.db import transaction, close_old_connections, DatabaseError
from django.utils import timezone
from ipc_core.protocol import decode, encode, validate, topic
from .models import Device, Receipt, RuntimeEvent, Operation, Outbox
from .services import queue, full_snapshot, expire_operations

log = logging.getLogger(__name__)


@transaction.atomic
def receive(route, raw):
    parts = route.split("/")
    if len(parts) != 5:
        raise ValueError("Invalid route")
    device = Device.objects.select_for_update().get(pk=parts[2], enabled=True)
    message = decode(raw, device.secret)
    validate(route, message, device.pk, device.device_type, "up")
    kind, payload = message["message_type"], message["payload"]
    if kind == "ack.command":
        Outbox.objects.filter(pk=message["correlation_id"], device=device,
            body__message_type="command.finalize").update(acknowledged=True)
        return
    if kind == "ack.applied":
        out = Outbox.objects.filter(pk=message["correlation_id"], device=device).first()
        if out and out.channel == "sync":
            if message.get("dataset_id") != device.pk or message.get("revision") != out.body["revision"]:
                raise ValueError("Sync ACK does not match transfer")
            Outbox.objects.filter(device=device, channel="sync", body__revision__lte=message["revision"]).update(acknowledged=True)
            device.acknowledged_revision = max(device.acknowledged_revision, message["revision"])
            device.last_sync = timezone.now()
            device.save(update_fields=["acknowledged_revision", "last_sync"])
        return
    seen = Receipt.objects.filter(device=device, message_id=message["message_id"]).exists()
    if not seen:
        if kind == "status.heartbeat":
            # Stale queued heartbeats must not grant a new online lease.
            from datetime import datetime
            age = (timezone.now()-datetime.fromisoformat(message["timestamp"])).total_seconds()
            if -10 <= age <= 45:
                device.last_seen = timezone.now()
                device.serial_connected = payload.get('serial_connected') is True
                device.save(update_fields=["last_seen", "serial_connected"])
                queue(device, "status", "status.lease", {"expires_at": (timezone.now()+timedelta(seconds=35)).isoformat(), "revision": device.revision})
        elif kind in {"sync.request", "sync.error"}:
            if message.get("dataset_id") != device.pk:
                raise ValueError("Unauthorized dataset")
            # Materialized snapshot is immutable at a revision; batching never reads live tables.
            Outbox.objects.filter(device=device, channel="sync", acknowledged=False).update(acknowledged=True)
            full_snapshot(device)
        elif kind == "events.command_result":
            op = Operation.objects.select_for_update().get(pk=message["command_id"], device=device)
            state = payload["state"]
            if state not in {"sent", "uncertain", "expired", "confirmed", "failed"}:
                raise ValueError("Invalid device operation state")
            if state in {"confirmed", "failed"} and op.state != state:
                raise ValueError("Device cannot confirm official inventory")
            if op.state == "queued" or (op.state == "uncertain" and state == "sent"):
                op.state = state
                if op.execution_state == 'awaiting_device':
                    op.execution_state = 'sent_to_serial' if state == 'sent' else state
                    op.execution_updated_at = timezone.now()
                op.save(update_fields=["state", "execution_state", "execution_updated_at"])
            Outbox.objects.filter(device=device, channel="command", body__message_type="command.execute", body__command_id=str(op.pk)).update(acknowledged=True)
        elif kind in {"telemetry.sample", "events.serial"}:
            address = payload.get("rack_id")
            if address is not None and not device.cabinet_set.filter(rack__address=address).exists():
                raise ValueError("Telemetry rack outside assignment")
            RuntimeEvent.objects.create(device=device, message_id=message["message_id"], payload=payload)
            from .monitoring import ingest
            ingest(device, payload, message["timestamp"])
            # Legacy Serial has no command_id. Correlate conservatively only after a
            # matching moving state, never from initial/idle endpoint snapshots.
            from datetime import datetime
            operation = Operation.objects.filter(device=device, rack__address=address,
                state__in=['queued', 'sent', 'uncertain']).select_related('rack').first()
            if operation and datetime.fromisoformat(message['timestamp']) >= operation.created_at:
                expected = {'OPEN': 1, 'CLOSE': 2, 'VENTILATE': 3, 'LIGHT': 0}.get(operation.kind, 1)
                faults = any(payload.get(k) for k in ('is_obstructed', 'is_skewed', 'is_overload_motor'))
                execution = operation.execution_state
                if faults:
                    execution = 'fault'
                elif payload.get('state') == expected:
                    execution = 'completed' if expected == 0 else 'moving'
                elif execution == 'moving' and payload.get('state') == -1 and payload.get('is_endpoint') == 1:
                    position = payload.get('displacement')
                    if (expected == 1 and isinstance(position, (float, int)) and position > 0) or (expected in (2, 3) and position == 0):
                        execution = 'completed'
                if execution != operation.execution_state:
                    operation.execution_state = execution
                    operation.execution_updated_at = timezone.now()
                    operation.save(update_fields=['execution_state', 'execution_updated_at'])
        else:
            raise ValueError("Unsupported message")
        Receipt.objects.create(device=device, message_id=message["message_id"])
    queue(device, "ack", "ack.received", {}, correlation_id=message["message_id"])


def run_worker(stop=None):
    import paho.mqtt.client as mqtt
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=os.environ.get("MQTT_SERVER_CLIENT_ID", "inventory-server"),
                         clean_session=False, manual_ack=True)
    client.username_pw_set(os.environ["MQTT_USERNAME"], os.environ["MQTT_PASSWORD"])
    if os.environ.get("MQTT_TLS", "1") == "1":
        client.tls_set(ca_certs=os.environ.get("MQTT_CA") or None)
    client.reconnect_delay_set(1, 30)
    reconnect_needed = threading.Event()
    def connected(c, userdata, flags, reason, properties):
        if not reason.is_failure:
            c.subscribe("inventory/v1/+/up/+", qos=1)
    def incoming(c, userdata, msg):
        close_old_connections()
        try:
            receive(msg.topic, msg.payload)
        except (ValueError, KeyError, TypeError, Device.DoesNotExist, Operation.DoesNotExist) as exc:
            log.exception("Rejected MQTT packet")
            # Only authenticated envelopes may receive a signed rejection. This
            # keeps revoked-scope telemetry from blocking the sender's outbox.
            try:
                device = Device.objects.get(pk=msg.topic.split("/")[2], enabled=True)
                rejected = decode(msg.payload, device.secret)
                validate(msg.topic, rejected, device.pk, device.device_type, "up")
                with transaction.atomic():
                    queue(device, "ack", "ack.rejected", {"reason": str(exc)}, correlation_id=rejected["message_id"])
            except (ValueError, KeyError, TypeError, IndexError, Device.DoesNotExist):
                pass
        except Exception:
            log.exception("Database/processing failure; retry after reconnect")
            reconnect_needed.set()
            c.disconnect()
            return
        finally:
            close_old_connections()
        c.ack(msg.mid, msg.qos)
    client.on_connect, client.on_message = connected, incoming
    client.connect_async(os.environ["MQTT_HOST"], int(os.environ.get("MQTT_PORT", "8883")), keepalive=20)
    client.loop_start()
    try:
        while stop is None or not stop.is_set():
            close_old_connections()
            if reconnect_needed.is_set():
                try:
                    client.loop_stop()
                    client.reconnect()
                    client.loop_start()
                    reconnect_needed.clear()
                except OSError:
                    log.exception("Reconnect failed; retrying")
            if not client.is_connected():
                time.sleep(1)
                continue
            cutoff = timezone.now()-timedelta(seconds=5)
            from django.db.models import Q
            try:
                expire_operations()
                rows = list(Outbox.objects.filter(acknowledged=False, device__enabled=True).filter(Q(sent_at=None)|Q(sent_at__lt=cutoff)).select_related("device")[:100])
            except DatabaseError:
                log.exception("Database unavailable; retaining outbox and retrying")
                time.sleep(2)
                continue
            for out in rows:
                try:
                    info = client.publish(topic(out.device_id, "down", out.channel), encode(out.body, out.device.secret), qos=1)
                    info.wait_for_publish(timeout=3)
                    if info.is_published():
                        update = {"sent_at": timezone.now(), "attempts": out.attempts+1}
                        if out.channel in {"ack", "status"}:
                            update["acknowledged"] = True
                        # An application ACK may race ahead of this PUBACK update.
                        # Never reset an already acknowledged durable message.
                        Outbox.objects.filter(pk=out.pk).update(**update)
                except Exception:
                    log.exception("Outbox publish failed; retrying")
                    break
            time.sleep(1)
    finally:
        client.disconnect()
        client.loop_stop()
        from django.db import connections
        connections.close_all()
