# IPCSIM Backend API Check Commands

uvicorn main:app --reload

> Run these commands while the IPCSIM backend is running on `http://localhost:8000`.

## 1. Basic backend and health checks

```bash
curl http://localhost:8000/
curl http://localhost:8000/api/serial/status
curl http://localhost:8000/api/system/health
```

## 2. Environment telemetry

```bash
curl http://localhost:8000/api/environment
curl http://localhost:8000/api/environment/latest
curl http://localhost:8000/api/environment/history?hours=1
```

## 3. Operation telemetry

```bash
curl http://localhost:8000/api/operation
curl http://localhost:8000/api/breakdown
```

## 4. Cabinet / rack control commands

```bash
curl http://localhost:8000/api/cabinets
curl http://localhost:8000/api/cabinets/1/racks

curl -X POST http://localhost:8000/api/cabinets/1/ventilate
curl -X POST http://localhost:8000/api/racks/1/open
curl -X POST http://localhost:8000/api/racks/1/close
curl -X POST http://localhost:8000/api/racks/1/ventilate
```

## 5. Notes

- Adjust `1` to the actual `cabinet_id` or `rack_id` in your database.
- Use `-s` to suppress progress output and `-v` to enable verbose HTTP debugging.
- If your backend is not on `localhost:8000`, replace the host and port accordingly.
