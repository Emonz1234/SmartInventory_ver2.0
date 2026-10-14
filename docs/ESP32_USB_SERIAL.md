# IPC ↔ ESP32 Master USB Serial

## Architecture and changed files

The existing `SerialManager` and `HardwareAdapter` are extended; `SimulationAdapter`,
Simulation wire format and recovery service remain in use for IPCSIM.
`SerialListener` runs blocking reads/writes in worker threads, reconnects and polls deadlines.
`Runtime` records actual mechanical evidence in the existing operation history and PUT/PICK
state machine. A write or ACK never completes an operation. Active transactions accept
only STATE endpoints; periodic STATUS reconciles idle rack position without completing
an interrupted operation. Operations failed on disconnect require operator inspection.

- `esp32_master_serial/src/main.cpp`: bounded newline parser, servo state machine,
  limit/ADC safety checks, latched errors, DHT/LCD and JSON telemetry.
- `ipc_core/adapters.py`: hardware protocol and existing domain event mapping.
- `ipc_core/app/serial/serial_manager.py`: pending commands, heartbeat, timeout,
  STOP and reconnect STATUS; port config remains in existing settings.
- `ipc_core/app/serial/listener.py`: polling, parsing and reconnect interval.
- `ipc_core/app/core/config.py`, `IPC/.env.example`: serial configuration.
- `ipc_core/runtime.py`: hardware command history and aggregate hardware faults.
- `ipc_core/transaction_service.py`: idempotent endpoints and STOP failure handling.
- `ipc_core/store.py`, `ipc_core/operator_api.py`: STOP/RESET/STATUS via existing
  authenticated device command route; STOP can interrupt an active PUT/PICK.
- `ipc_core/api.py`: hardware_racks and hardware_pending on system health.
- `IPCSIM/frontend/src/components/RackOperationPanel.tsx`: retain the existing
  Cabinet & Rack layout for both IPC and IPCSIM. IPC Open R1 sends OPEN 1;
  Return Home sends CLOSE for the selected rack. Actual hardware command history
  determines completion without assuming Simulation travel distances.
- `tests/test_esp32_adapter.py`, `tests/test_esp32_commands.py`,
  `tests/test_esp32_workflow.py`, `tests/esp32_ui_browser.cjs`: protocol, workflow, UI and
  transport regression tests. Existing transport/location/Simulation tests also apply.

## Configuration

In the existing IPC environment file (normally `IPC/.env`, selected by launcher):

```dotenv
DEVICE_TYPE=IPC
HARDWARE_ENABLED=true
SERIAL_ENABLED=true
SERIAL_PORT=COM5
SERIAL_BAUDRATE=115200
SERIAL_COMMAND_TIMEOUT=8
SERIAL_RECONNECT_INTERVAL=3
```

Choose the actual Windows COM port; COM5 is only an example. Keep IPCSIM at its
existing baudrate and protocol. Install existing `requirements.txt` dependencies.
Match the assigned rack's `rack_code` to its serial address (currently `1`), not
its database primary key. IPC accepts arbitrary positive rack addresses up to
65535. Master currently owns local rack 1; other racks receive `INVALID_RACK`
until ESP-NOW routing is implemented. Unsupported LIGHT/VENTILATE/HOME commands
are explicitly rejected by the hardware adapter.

## Wire protocol

UTF-8/ASCII, 115200 baud, one message per LF; CRLF is accepted. Case sensitive.

```
OPEN <rack_id>
CLOSE <rack_id>
STOP <rack_id>
RESET <rack_id>
STATUS <rack_id>
PING

ACK <command> <rack_id>
STATE <rack_id> <state>
ERROR <rack_id> <error_code>
STATUS <rack_id> <state> <open_limit> <close_limit> <mq2>
PONG
```

Limits are **1 when activated (GPIO LOW)**, 0 when free. MQ2 is raw ADC 0..4095.
States: UNKNOWN, CLOSED, OPENING, OPENED, CLOSING, STOPPED, ERROR.
Errors: OPEN_TIMEOUT, CLOSE_TIMEOUT, LIMIT_CONFLICT, SMOKE_ALARM,
COMMUNICATION_ERROR (IPC timeout/disconnect), INVALID_COMMAND, INVALID_RACK, BUSY.
Malformed/unaddressed commands use `ERROR 0 INVALID_COMMAND`.
STATUS does not need an ACK. JSON telemetry keeps temperature, humidity, gas,
and gas_alert compatible with existing IPC handlers. Endpoint displacement in
normalized domain events is a logical marker (1=open, 0=closed), not measured mm.

```
OPEN 1
ACK OPEN 1
STATE 1 OPENING
STATE 1 OPENED
```

Servo pulses: GPIO13, OPEN=1300µs, STOP=1500µs, CLOSE=1700µs; motion deadline=5s.
GPIO32/33 use pull-ups. MQ2 GPIO34 alarm threshold=2000 raw ADC (calibrate for
actual sensor). LED GPIO26 and buzzer GPIO25 remain on until safe RESET. STOP
stops immediately; if a fault is latched, ERROR remains rather than clearing it.
DHT reads are deferred during motion. LCD updates are bounded by I2C timeout.
An opposite movement command during motion is rejected with BUSY; repeated same
movement acknowledges without restarting its deadline. RESET never starts motion.

## Build and test

```powershell
python -m platformio run -d esp32_master_serial
python -m pytest tests/test_serial_transport.py tests/test_esp32_adapter.py tests/test_esp32_commands.py tests/test_esp32_workflow.py tests/test_serial_location.py tests/test_operation_history.py tests/test_inventory_workflow.py -q
cd IPCSIM/frontend
npm run build
```

With Playwright available at the project's existing `.tools/ui` location,
run `node tests/esp32_ui_browser.cjs` from the repository root after building.

Flash deliberately using PlatformIO Upload, then close Serial Monitor before
starting IPC (only one process may own COM). Start IPC with its existing launcher,
log in with an operator having cabinet.control, open Cabinet Detail and use the
existing Open R1 control. Confirm history shows completed only after endpoint STATE.
For low-level checks, stop IPC first and use Serial Monitor at 115200 with newline.

## Physical end-to-end checklist (requires connected rack)

- [ ] OPEN from CLOSED: ACK → OPENING → OPENED, servo stops on GPIO32 LOW.
- [ ] CLOSE from OPENED: ACK → CLOSING → CLOSED, servo stops on GPIO33 LOW.
- [ ] Repeat OPEN when OPENED / CLOSE when CLOSED: endpoint STATE, no movement.
- [ ] Hold OPEN limit free: OPEN_TIMEOUT after 5s, STOP and alarm.
- [ ] Hold CLOSE limit free: CLOSE_TIMEOUT after 5s, STOP and alarm.
- [ ] STOP during movement: prompt stop, STOPPED; original command not completed.
- [ ] Both limits LOW: LIMIT_CONFLICT even while idle; RESET refused while active.
- [ ] MQ2 ≥ threshold: SMOKE_ALARM, stop, LED/buzzer on, movement refused.
- [ ] Clear hazard then RESET: alarm off, re-read CLOSED/OPENED/UNKNOWN.
- [ ] Disconnect USB during movement: UI disconnected, no new commands, no crash;
      firmware motion still stops at endpoint or 5s timeout.
- [ ] Reconnect USB: PING/PONG and STATUS synchronize actual rack state;
      interrupted commands remain failed/unconfirmed, never silently replayed.
- Last confirmed OPENED/CLOSED is saved per rack in the IPC SQLite table
  `hardware_rack_state`. Disconnect, communication errors and UNKNOWN after
  reconnect preserve this display position, including across IPC restarts.
  The UI labels it as the last confirmed position while awaiting fresh endpoint
  evidence. This display cache does not authorize inventory confirmation or
  complete interrupted commands; business evidence is reconciled independently.
- [ ] Invalid command, missing/extra tokens and oversized lines: INVALID_COMMAND.
- [ ] OPEN 2 / negative or malformed rack id: error; local servo never moves.
- [ ] PUT/PICK: open endpoint permits quantity confirmation; close endpoint completes
      existing inventory workflow. ACK alone never applies inventory.
- [ ] IPCSIM open/close/recovery still follows existing Simulation protocol.

Build/tests cannot verify servo calibration, switch wiring, sensor calibration or
physical response latency. Run this checklist before operating actual inventory.
