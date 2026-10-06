import asyncio

from ipc_core.app.serial import serial_manager

from ipc_core.app.serial.handlers.telemetry_handler import TelemetryHandler
from ipc_core.app.serial.handlers.event_handler import EventHandler
from ipc_core.app.serial.handlers.ack_handler import AckHandler
import traceback


class SerialListener:

    def __init__(self):

        self.telemetry_handler = TelemetryHandler()

        self.event_handler = EventHandler()

        self.ack_handler = AckHandler()

    async def start(self):
        if hasattr(serial_manager, 'links'):
            await asyncio.gather(*(self.start_link(link, group) for group, link in serial_manager.links.items()))
        else:
            await self.start_link(serial_manager)

    async def start_link(self, link, group=None):

        print("Serial Listener Started")

        while True:

            try:
                if not link.connected:
                    await asyncio.to_thread(link.connect)
                runtime = getattr(serial_manager.observer, '__self__', None)
                if runtime and runtime.recovery:
                    await asyncio.to_thread(runtime.recovery.poll, group)
                raw = await asyncio.to_thread(link.read)
            except Exception:
                link.disconnect()
                runtime = getattr(serial_manager.observer, '__self__', None)
                if runtime and runtime.recovery:
                    runtime.recovery.lost(group)
                await asyncio.sleep(2)
                try:
                    await asyncio.to_thread(link.connect)
                except Exception:
                    pass
                continue

            if raw:

                print("RX:", raw)

                await self.process(raw, group)

            await asyncio.sleep(0.01)

    async def process(self, raw: str, group=None):
        try:
            message = serial_manager.adapter.parse(raw)
            if message.msg_type == 'simulation_state' and group is not None and message.payload.get('cabinet_index') != group:
                raise ValueError('State snapshot outside configured Serial group')
            if group is not None and 'rack_id' in message.payload:
                from Simulation.topology import RACKS_PER_GROUP
                if (int(message.payload['rack_id']) - 1) // RACKS_PER_GROUP + 1 != group:
                    raise ValueError('Serial frame outside configured group')
            print(f"PARSED (Serial) msg_type={message.msg_type} payload={message.payload}")
            if serial_manager.observer:
                serial_manager.observer(message)
            payload = dict(message.payload)
            # Serial address is distinct from Server database rack ID.
            if "rack_id" in payload:
                from ipc_core.app.database.database import SessionLocal
                from ipc_core.app.database.models.inventory import Cabinet, Rack
                with SessionLocal() as db:
                    rack = db.query(Rack).filter(Rack.rack_code == str(payload["rack_id"])).one_or_none()
                    if rack is None:
                        print(f"[MAP] Unassigned Serial address={payload['rack_id']}; snapshot skipped")
                        return
                    cabinet = db.get(Cabinet, rack.cabinet_id)
                    if cabinet is None:
                        raise ValueError('Rack has no parent cabinet')
                    payload.update(serial_address=payload['rack_id'], rack_id=rack.id,
                                   rack_index=rack.rack_index, cabinet_index=cabinet.cabinet_index,
                                   device_code=cabinet.device_code)
                    from ipc_core.app.serial.location import describe_location
                    print(f"[MAP] {describe_location(payload)}")
        except Exception as e:
            print(f"[PARSE ERROR] raw={raw} error={e}")
            traceback.print_exc()
            return

        try:
            if message.msg_type == "telemetry":
                await self.telemetry_handler.handle(payload)

            elif message.msg_type == "event":
                await self.event_handler.handle(payload)

            elif message.msg_type == "ack":
                await self.ack_handler.handle(payload)
            else:
                # unknown message types are ignored but logged
                print(f"Unhandled message type: {message.msg_type}")
        except Exception as e:
            print(f"[HANDLER ERROR] type={message.msg_type} error={e}")
            traceback.print_exc()
