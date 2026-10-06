"""One edge application used by both launchers; existing read APIs are retained."""
import asyncio
import hmac
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, Request
from fastapi import Query
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from ipc_core.app.core.config import settings
from ipc_core.app.startup import initialize_database, start_serial
from ipc_core.app.serial import serial_manager
from ipc_core.app.api import cabinet, inventory, bins, telemetry, dashboard
from ipc_core.runtime import Runtime
from ipc_core.operator_api import router as operator_router
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


@asynccontextmanager
async def lifespan(app):
    settings.require_identity()
    initialize_database()
    app.state.runtime = Runtime(settings, serial_manager)
    serial_manager.observer = app.state.runtime.record_serial
    app.state.runtime.start()
    task = await start_serial() if settings.SERIAL_PORT or settings.SERIAL_GROUP_PORTS else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        app.state.runtime.stop()
        serial_manager.disconnect()


app = FastAPI(title="Smart Inventory Edge", lifespan=lifespan)


@app.middleware("http")
async def ownership(request: Request, call_next):
    if request.method == 'GET' and (request.url.path == '/ui' or request.url.path.startswith('/ui/')):
        return await call_next(request)
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not settings.EDGE_API_TOKEN or not hmac.compare_digest(token, settings.EDGE_API_TOKEN):
        return JSONResponse({"detail": "Edge API token required"}, status_code=401)
    # Old GET command routes must not bypass central operation authorization.
    is_command = request.url.path.endswith(("/open", "/close", "/ventilate", "/clear-breakdown"))
    if (request.method not in {"GET", "HEAD", "OPTIONS"} or is_command) and not request.url.path.startswith('/api/operator/'):
        return JSONResponse({"detail": "Write through Server /api/operations or master-data API; local cache is read-only"}, status_code=409)
    return await call_next(request)


for router in [cabinet.router, inventory.router, bins.router, telemetry.router, dashboard.router]:
    app.include_router(router)

app.include_router(operator_router)
frontend = Path(__file__).resolve().parents[1] / 'IPCSIM' / 'frontend' / 'dist'
if (frontend / 'assets').is_dir():
    app.mount('/ui/assets', StaticFiles(directory=frontend / 'assets'), name='ui-assets')


@app.get('/ui')
@app.get('/ui/{path:path}')
def edge_ui(path=''):
    if not (frontend / 'index.html').is_file():
        return JSONResponse({'detail': 'Build frontend: npm --prefix IPCSIM/frontend run build'}, status_code=503)
    return FileResponse(frontend / 'index.html')


@app.get("/")
def root():
    return {"app": settings.APP_NAME, "device_id": settings.DEVICE_ID, "device_type": settings.DEVICE_TYPE}


@app.get('/api/faults/overview')
def fault_overview(cabinet: int | None = None, rack: int | None = None,
                   severity: str | None = None, status: str | None = None,
                   hours: int = Query(default=24, ge=1, le=720), search: str = Query(default='', max_length=128),
                   offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100)):
    return app.state.runtime.faults.overview(cabinet=cabinet, rack=rack, severity=severity,
                                            status=status, hours=hours, search=search, offset=offset, limit=limit)


@app.get('/api/faults/{fault_id}')
def fault_detail(fault_id: int):
    rows = app.state.runtime.faults.overview(fault_id=fault_id)['history']
    if not rows:
        raise HTTPException(404,'Fault occurrence not found')
    return rows[0]


@app.get("/serial/status")
@app.get("/api/serial/status")
def serial_status():
    return {"connected": serial_manager.connected, "port": settings.SERIAL_PORT,
            "groups": {str(k): v.connected for k, v in getattr(serial_manager, 'links', {}).items()}}


@app.get("/health")
def legacy_health():
    return {"status": "connected" if serial_manager.connected else "disconnected"}


@app.get("/api/system/health")
def health():
    runtime = app.state.runtime
    rev = runtime.store.revision()
    from Simulation.topology import RACKS_PER_GROUP
    links = getattr(serial_manager, 'links', {})
    routes = {str(row['data']['id']): (links.get((int(row['data']['rack_code'])-1)//RACKS_PER_GROUP+1).connected
              if (int(row['data']['rack_code'])-1)//RACKS_PER_GROUP+1 in links else False)
              for row in runtime.store.records() if row['kind'] == 'rack'} if links else {}
    local_state = runtime.sync.repo.state()
    hardware_status = 'ONLINE' if serial_manager.connected else 'OFFLINE'
    fault_reasons = []
    simulation_states = runtime.recovery.states() if runtime.recovery else []
    any_simulation_online = serial_manager.connected and any(state.get('online') for state in simulation_states)
    def report_state_fault(state):
        if state['system_state'] not in {'ERROR', 'RECOVERING', 'STOPPED', 'COMMUNICATION_LOST'}:
            return False
        code = (state.get('fault_context') or {}).get('error_code') or state['system_state']
        return not (any_simulation_online and code == 'COMMUNICATION_LOST')
    with runtime.store.transaction() as db:
        uncertain = db.execute("SELECT transaction_id,address,motion_address,phase FROM local_transactions WHERE operation_status='UNCERTAIN'").fetchall()
        fault = bool(uncertain)
        for row in uncertain:
            address = row['motion_address'] or row['address']
            fault_reasons.append({'error_code': 'TRANSACTION_UNCERTAIN', 'command_id': row['transaction_id'],
                                  'cabinet_index': (address-1)//RACKS_PER_GROUP+1 if address else None,
                                  'rack_id': address, 'current_step': row['phase']})
        initialized = runtime.store.revision(db=db) > 0
        has_auth = db.execute("SELECT 1 FROM edge_records WHERE key LIKE 'auth:%' LIMIT 1").fetchone() is not None
    if fault or runtime.hardware_fault:
        hardware_status = 'FAULT'
    for state in simulation_states:
        if report_state_fault(state):
            context = state.get('fault_context') or {}
            fault_reasons.append({**context, 'cabinet_index': state['cabinet_index'],
                                  'system_state': state['system_state'], 'online': state.get('online'),
                                  'error_code': context.get('error_code') or state['system_state']})
    if runtime.hardware_fault:
        details = getattr(runtime, 'hardware_fault_details', {})
        address = details.get('rack_id')
        for flag, code in [('is_obstructed', 'OBSTRUCTED'), ('is_skewed', 'SKEWED'), ('is_overload_motor', 'MOTOR_OVERLOAD')]:
            if details.get(flag):
                fault_reasons.append({'error_code': code, 'rack_id': address,
                                      'cabinet_index': (int(address)-1)//RACKS_PER_GROUP+1 if address else None})
        if not details:
            fault_reasons.append({'error_code': 'HARDWARE_FAULT'})
    if any(report_state_fault(s) for s in simulation_states):
        hardware_status = 'FAULT'
    available = initialized and has_auth and hardware_status == 'ONLINE' and serial_manager.adapter.supports_commands
    return {**local_state, 'hardware_status': hardware_status,
            'simulation_states': simulation_states, 'fault_reasons': fault_reasons,
            'server_connection_status': ('CONNECTED' if runtime.synced else 'SYNCING') if runtime.online else 'DISCONNECTED',
            'offline_mode': not runtime.online, 'local_operation_available': available,
            "device_id": settings.DEVICE_ID, "device_type": settings.DEVICE_TYPE,
            "serial_connected": serial_manager.connected, "simulation_online": settings.DEVICE_TYPE == "IPCSIM" and serial_manager.connected,
            "hardware_enabled": settings.DEVICE_TYPE != "IPC" or settings.HARDWARE_ENABLED,
            "hardware_commands_supported": serial_manager.adapter.supports_commands,
            "database_healthy": True, "server_synced": runtime.synced,
            "serial_groups": serial_status()['groups'],
            "serial_routes": routes,
            "server_online": runtime.online, "revision": rev}


@app.get("/api/operations/pending")
def pending():
    with app.state.runtime.store.transaction() as db:
        return [dict(r) for r in db.execute("SELECT * FROM edge_operations WHERE state NOT IN ('confirmed','failed','local_sent','rejected')")]


@app.get("/api/device/snapshot")
def device_snapshot():
    runtime = app.state.runtime
    with runtime.store.transaction() as db:
        events = [dict(r) for r in db.execute("SELECT * FROM edge_runtime ORDER BY rowid DESC LIMIT 100")]
        backlog = db.execute("SELECT count(*) FROM edge_outbox").fetchone()[0]
    from ipc_core.operation_history import history as operation_history
    history = operation_history(runtime)
    return {"health": health(), "records": runtime.store.public_records(), "racks": legacy_racks(),
            "pending": pending(), "operation_history": history, "events": events, "outbox_count": backlog}


@app.get("/api/racks")
def legacy_racks():
    from ipc_core.app.database.database import SessionLocal
    from ipc_core.app.database.models.inventory import Rack
    from ipc_core.app.database.models.environment import EnvironmentSnapshot
    from ipc_core.app.database.models.runtime import OperationSnapshot, BreakdownSnapshot
    with SessionLocal() as db:
        result = {}
        for rack in db.query(Rack).all():
            last = db.query(EnvironmentSnapshot).filter_by(rack_id=rack.id).order_by(EnvironmentSnapshot.id.desc()).first()
            operation = db.query(OperationSnapshot).filter_by(rack_id=rack.id).order_by(OperationSnapshot.id.desc()).first()
            breakdown = db.query(BreakdownSnapshot).filter_by(rack_id=rack.id).order_by(BreakdownSnapshot.id.desc()).first()
            fault = bool(breakdown and (breakdown.is_obstructed or breakdown.is_skewed or breakdown.is_overload_motor))
            result[rack.rack_code] = {"temperature": last.temperature if last else None,
                "humidity": last.humidity if last else None, "smoke": last.smoke_detected if last else None,
                "gas": last.gas if last else None,
                "position": operation.displacement if operation else None, "error": int(fault),
                "status": "ERROR" if fault else ("OK" if last or operation else "UNKNOWN"),
                "last_update": str(last.created_at) if last else None}
        return result


@app.get("/api/rack/{rack_address}")
def legacy_rack(rack_address: str):
    from fastapi import HTTPException
    rows = legacy_racks()
    if rack_address not in rows:
        raise HTTPException(404, "Rack not found")
    return {"rack_id": rack_address, **rows[rack_address]}


@app.get("/api/history/{rack_address}")
def legacy_history(rack_address: str):
    from ipc_core.app.database.database import SessionLocal
    from ipc_core.app.database.models.inventory import Rack
    from ipc_core.app.database.models.environment import EnvironmentSnapshot
    with SessionLocal() as db:
        rack = db.query(Rack).filter_by(rack_code=rack_address).first()
        if rack is None:
            return []
        samples = db.query(EnvironmentSnapshot).filter_by(rack_id=rack.id).order_by(EnvironmentSnapshot.id.desc()).limit(50).all()
        return [{"time": str(s.created_at), "temperature": s.temperature, "humidity": s.humidity, "gas": s.gas} for s in reversed(samples)]


@app.get("/api/summary")
def legacy_summary():
    rows = legacy_racks()
    temperatures = [r["temperature"] for r in rows.values() if r["temperature"] is not None]
    humidities = [r["humidity"] for r in rows.values() if r["humidity"] is not None]
    return {"total_racks": len(rows), "avg_temperature": sum(temperatures)/len(temperatures) if temperatures else 0,
            "error_racks": sum(r["error"] for r in rows.values()), "max_gas": max((r["gas"] or 0 for r in rows.values()), default=0),
            "avg_humidity": sum(humidities)/len(humidities) if humidities else 0}
