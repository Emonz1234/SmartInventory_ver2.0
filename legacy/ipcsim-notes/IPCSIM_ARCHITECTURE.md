# IPCSIM System Architecture

## 1. Overview
IPCSIM is a warehouse rack inventory simulator consisting of:
- Backend: Python FastAPI application
- Frontend: React + TypeScript + Vite + Material UI
- Serial bridge: Python serial listener connecting to Simulation via COM port
- Local database: SQLite via SQLAlchemy

The system is designed to:
- receive telemetry and event data from a physical or simulated rack controller
- store runtime and environment snapshots in a database
- expose telemetry, command, inventory, and dashboard APIs
- provide a web UI for inventory operations, rack control, breakdown monitoring, and environment charts

## 2. Backend Architecture

### 2.1 Frameworks and libraries
- FastAPI: HTTP API server
- SQLAlchemy: ORM for SQLite database models
- `pyserial`: serial port communication
- `uvicorn`: ASGI server for running the app

### 2.2 Application startup
- `IPCSIM/main.py` creates a FastAPI app and registers:
  - `/api/telemetry`
  - `/api/cabinet`
  - `/api/inventory`
  - `/api/dashboard`
  - `/api/bins`
- Lifespan startup calls `app.startup.start_serial()`
- Serial listener `app.serial.listener.SerialListener` is started as an async task

### 2.3 Serial service
- `app.serial.serial_manager.SerialManager`
  - reads `SERIAL_PORT`/`SERIAL_BAUDRATE` from `app.core.config`
  - opens a serial connection with `serial.Serial(..., timeout=1)`
  - provides `send(message)` and `read()` methods
- `SerialListener.start()` continuously reads lines from serial port
  - raw data is parsed by `ProtocolParser`
  - parsed messages are dispatched to telemetry, event, or ack handlers

### 2.4 Serial protocol
- Parser: `app.serial.protocol.parser.ProtocolParser`
- Message format supported:
  - JSON-style messages with `type` field
  - legacy pipe-delimited messages

Supported legacy prefixes:
- `ENVSTT|rack_id|temperature|humidity|weight|smoke`
  - telemetry message
- `OPRSTT|rack_id|movement_speed|displacement|is_hard_locked|is_endpoint|state`
  - operation event
- `BRKSTT|rack_id|is_obstructed|is_skewed|is_overload_motor`
  - breakdown event
- `ACK|...`
  - acknowledgement message

### 2.5 Command builder
- `app.serial.protocol.builder.ProtocolBuilder`
- For outgoing serial commands, the builder serializes command messages as:
  - `0|{rack}|{action}`
- Action codes map to:
  - `OPEN_RACK` => `1`
  - `CLOSE_RACK` => `2`
  - `LIGHT_RACK` => `0`
  - `VENTILATE_RACK` => `3`

### 2.6 Serial event handlers
- `app.serial.handlers.telemetry_handler.TelemetryHandler`
  - stores environment telemetry to `EnvironmentSnapshot`
  - handles `temperature`, `humidity`, `weight`, `smoke` values
- `app.serial.handlers.event_handler.EventHandler`
  - stores operation snapshots when payload contains `movement_speed`
  - stores breakdown snapshots when payload contains `is_obstructed`
- `app.serial.handlers.ack_handler.AckHandler`
  - currently stubbed or placeholder; it receives ACK messages

## 3. Database Model

### 3.1 Environment telemetry
- Model: `EnvironmentSnapshot`
- Fields:
  - `rack_id`
  - `temperature`
  - `humidity`
  - `weight`
  - `smoke_detected`
  - `created_at`

### 3.2 Runtime telemetry
- `OperationSnapshot`
  - `rack_id`
  - `movement_speed`
  - `displacement`
  - `is_hard_locked`
  - `is_endpoint`
  - `state`
  - `created_at`
- `BreakdownSnapshot`
  - `rack_id`
  - `is_obstructed`
  - `is_skewed`
  - `is_overload_motor`
  - `created_at`

### 3.3 Time handling
- `app.utils.timezone` provides helpers such as `get_current_time()` and `format_datetime()`
- Datetimes are normalized to Vietnam timezone in responses

## 4. API Design

### 4.1 Telemetry API
- `GET /api/telemetry/environment`
  - returns latest environment snapshots
- `GET /api/telemetry/environment/latest`
  - latest single environment value
- `GET /api/telemetry/environment/history?hours=24`
  - history for past hours
- `GET /api/telemetry/operation`
  - returns recent operation snapshots
- `GET /api/telemetry/breakdown`
  - returns recent breakdown snapshots
- `GET /api/telemetry/breakdown/{rack_id}/latest`
  - latest breakdown status for a rack

### 4.2 Cabinet control API
- Defined in `app.api.cabinet`
- Likely routes for:
  - `POST /api/racks/{id}/open`
  - `POST /api/racks/{id}/close`
  - `POST /api/racks/{id}/clear-breakdown`
  - `POST /api/cabinets/{id}/ventilate`
- These routes use command services to send serial commands to the simulated rack

### 4.3 System status API
- `GET /serial/status`
- `GET /api/serial/status`
- `GET /api/system/health`

### 4.4 Inventory, dashboard, and other APIs
- `app.api.inventory` handles pick/put transactions
- `app.api.dashboard` provides summary counts and serial health
- `app.api.bins` provides bin/cabinet metadata

## 5. Frontend Architecture

### 5.1 Framework and libraries
- React 18 + TypeScript
- Vite for bundling and development
- Material UI for layout and components
- Axios for REST requests
- React Query for data fetching/caching
- React Router v6 for routing

### 5.2 Core frontend flow
- `IPCSIM/frontend/src/App.tsx` defines routes for:
  - `/`: Dashboard
  - `/inventory`
  - `/cabinets`
  - `/cabinets/:id`
  - `/transactions`
  - `/breakdown`
  - `/environment`
  - `/operation`
  - `/logs`
  - `/system`
  - `/maintenance`
- API clients live in `frontend/src/api`
  - `client.ts` creates Axios instance
  - `system.ts` exposes telemetry and system endpoints
  - `cabinet.ts` exposes rack command endpoints

### 5.3 Inventory and rack control
- `Inventory.tsx` implements pick/put workflows
- It uses `systemAPI.getOperationData()` to poll for rack open completion
- Before opening/closing, it calls `systemAPI.getBreakdownStatus(rackId)` to avoid acting on broken racks
- `CabinetDetail.tsx` provides detail view per cabinet and rack controls
  - opens/closes racks via `cabinetAPI.openRack()` and `cabinetAPI.closeRack()`
  - shows breakdown alerts and allows manual clear via `clearRackBreakdown`
  - uses `OperationModal` to show ongoing operation progress

### 5.4 Operation and environment pages
- `Environment.tsx` shows telemetry charts and history from `/api/telemetry/environment`
- `Operation.tsx` lists operation logs from `/api/telemetry/operation`
- `Logs.tsx` can combine operation and breakdown data for history

### 5.5 WebSocket support
- There is a generic frontend hook `useWebSocket` for real-time updates
- No active websocket server implementation found in current backend files (empty `app/websocket/*`), so IPCSIM currently relies on polling for telemetry and operation status

## 6. Simulation integration

### 6.1 Serial port connection
- Backend connects to a COM port using `pyserial`
- `SerialManager.connect()` opens the configured serial port and `SerialListener` continuously reads data
- The simulation device must send newline-terminated text messages

### 6.2 Message format
- Incoming serial messages can be JSON or legacy pipe format
- Example legacy telemetry message:
  - `ENVSTT|2|26.5|45.0|10.2|0`
- Example legacy operation event:
  - `OPRSTT|3|1.4|42.0|0|1|1`
- Example legacy breakdown event:
  - `BRKSTT|3|0|1|0`
- Example ack message:
  - `ACK|...`

### 6.3 Data lifecycle
- Serial message arrives at backend
- `SerialListener` parses the message and chooses a handler
- For environment telemetry:
  - `TelemetryHandler` writes an `EnvironmentSnapshot`
- For operation events:
  - `EventHandler` writes an `OperationSnapshot`
- For breakdown events:
  - `EventHandler` writes a `BreakdownSnapshot`
- The HTTP API exposes that data to frontend pages

## 7. Operation flow

### 7.1 Command issuance
- Frontend user action triggers `cabinetAPI` command call
- Backend command service builds serial command string and sends it through `SerialManager`
- Example: open rack
  - `ProtocolBuilder.build('command', { command: 'OPEN_RACK', rack: 5 })` -> `0|5|1`

### 7.2 Watching rack status
- The controller/simulator responds with operation events over serial
- Backend stores them in `operation_snapshots`
- Frontend polls `/api/telemetry/operation` and uses `is_endpoint` plus `displacement` to detect completion

### 7.3 Breakdown protection
- Frontend checks `/telemetry/breakdown/{rack_id}/latest` before open/close operations
- User sees an error popup if the rack has an active breakdown
- Backend can also clear stale breakdown state or enforce safety on the server side

## 8. Key design decisions

- Separation of concerns:
  - serial I/O and parsing in `app.serial`
  - domain event persistence in `app.serial.handlers`
  - HTTP endpoints in `app.api`
  - business services in `app.services`
- Telemetry as append-only snapshots:
  - environment snapshots store current sensor values
  - operation snapshots store runtime motion status and endpoint hits
  - breakdown snapshots store last-known fault flags
- UI driven by React Query and Axios, with polling for runtime status
- Serial command protocol is simple and compatible with both JSON and legacy text

## 9. Running IPCSIM

- Start backend with FastAPI/uvicorn using `main.py`
- Ensure `app.core.config.SERIAL_PORT` and `SERIAL_BAUDRATE` match simulator port
- Start frontend with Vite using `npm install` and `npm run dev`
- Use frontend pages to view environment, operation, inventory, cabinets, and breakdowns

## 10. Notes

- WebSocket files exist but are currently empty, so the backend does not yet provide live WS telemetry
- The system is built to support both actual hardware and a simulation that writes serial messages in the supported format
- The backend exposes serial health endpoints for frontend status and troubleshooting
