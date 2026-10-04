import asyncio
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from ipc_core.adapters import SimulationAdapter
from ipc_core.app.database.database import Base
from ipc_core.app.database.models.inventory import Cabinet, Rack
from ipc_core.app.database.models.runtime import BreakdownSnapshot, OperationSnapshot
from ipc_core.app.database.models.environment import EnvironmentSnapshot
from ipc_core.app.serial.listener import SerialListener
from ipc_core.app.serial import listener
from ipc_core.app.serial.handlers import event_handler, telemetry_handler


@pytest.fixture
def serial_location_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'serial-location.sqlite3'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    from ipc_core.app.database import database
    for module in (database, event_handler, telemetry_handler):
        monkeypatch.setattr(module, 'SessionLocal', sessions)
    monkeypatch.setattr(listener.serial_manager, 'adapter', SimulationAdapter())
    observed = []
    monkeypatch.setattr(listener.serial_manager, 'observer', observed.append)
    with sessions() as db:
        for index in (1, 2):
            db.add(Cabinet(id=index + 1, cabinet_code=f'SIM-C{index:02d}', cabinet_index=index, device_code='IPCSIM01', device_type='SIMULATION'))
        db.flush()
        for address in range(1, 13):
            db.add(Rack(id=address + 6, cabinet_id=2 if address <= 6 else 3,
                        rack_code=str(address), rack_index=(address - 1) % 6 + 1))
        db.commit()
    yield sessions, observed
    engine.dispose()


@pytest.mark.parametrize('address', range(1, 7))
def test_breakdown_wire_address_is_not_mutated_into_database_pk(serial_location_db, capsys, address):
    sessions, observed = serial_location_db
    asyncio.run(SerialListener().process(f'BRKSTT|{address}|0|0|0', group=1))
    assert observed[0].payload['rack_id'] == address
    assert 'serial_address' not in observed[0].payload
    with sessions() as db:
        assert db.query(BreakdownSnapshot).one().rack_id == address + 6
    log = capsys.readouterr().out
    parsed = next(line for line in log.splitlines() if line.startswith('PARSED (Serial)'))
    assert f"'rack_id': {address}," in parsed
    assert f'cabinet_index=1 rack_index={address} serial_address={address} db_rack_id={address + 6}' in log


@pytest.mark.parametrize('frame,model', [
    ('OPRSTT|7|10|20|0|1|-1', OperationSnapshot),
    ('ENVSTT|7|25|60|10|0', EnvironmentSnapshot),
    ('BRKSTT|7|1|0|0', BreakdownSnapshot),
])
def test_second_cabinet_has_local_rack_one_and_wire_address_seven(serial_location_db, capsys, frame, model):
    sessions, observed = serial_location_db
    asyncio.run(SerialListener().process(frame, group=2))
    assert observed[0].payload['rack_id'] == 7
    with sessions() as db:
        assert db.query(model).one().rack_id == 13
    assert 'cabinet_index=2 rack_index=1 serial_address=7 db_rack_id=13' in capsys.readouterr().out


def test_frame_outside_serial_group_is_rejected(serial_location_db):
    sessions, observed = serial_location_db
    asyncio.run(SerialListener().process('BRKSTT|1|0|0|0', group=2))
    assert observed == []
    with sessions() as db:
        assert db.query(BreakdownSnapshot).count() == 0


def test_esp32_telemetry_uses_same_location_mapping(serial_location_db, monkeypatch):
    from ipc_core.adapters import HardwareAdapter
    sessions, observed = serial_location_db
    monkeypatch.setattr(listener.serial_manager, 'adapter', HardwareAdapter())
    asyncio.run(SerialListener().process('{"rack_id":1,"temperature":28.5,"humidity":65,"gas":2100,"gas_alert":true}'))
    assert observed[0].payload['rack_id'] == 1
    assert observed[0].payload['smoke'] == 1
    with sessions() as db:
        sample = db.query(EnvironmentSnapshot).one()
        assert (sample.rack_id, sample.temperature, sample.humidity, sample.gas, sample.smoke_detected) == (7, 28.5, 65, 2100, 1)
        assert sample.weight is None
