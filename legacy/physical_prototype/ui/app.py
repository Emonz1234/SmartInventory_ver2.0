from flask import Flask, render_template, jsonify
from serial_client.esp32_serial import ESP32SerialClient
import threading
from datetime import datetime
import os

# Create Flask app with static folder
app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'), static_url_path='/static')

# ===== SERIAL CLIENT =====
serial_client = None

def init_serial_client():
    global serial_client
    if serial_client is None:
        try:
            serial_client = ESP32SerialClient()
            serial_client.connect()
        except Exception as e:
            print(f"[ERROR] Serial client initialization failed: {e}")
            return False
    return True

# ===== API =====
@app.route("/api/racks")
def get_racks():
    """Lấy dữ liệu hiện tại của tất cả racks"""
    if not init_serial_client():
        return jsonify({"error": "Serial client not connected"}), 503
    
    data = {}

    for rack_id, rack in serial_client.rack_manager.racks.items():
        data[rack_id] = {
            "position": rack.position,
            "error": rack.error,
            "temperature": round(rack.temperature, 2),
            "humidity": round(rack.humidity, 2),
            "gas": round(rack.gas, 2),
            "smoke": rack.smoke,
            "last_update": str(rack.last_update),
            "status": "⚠️ ERROR" if rack.error else "✅ OK"
        }

    return jsonify(data)

@app.route("/api/rack/<rack_id>")
def get_rack(rack_id):
    """Lấy dữ liệu chi tiết của một rack"""
    if not init_serial_client():
        return jsonify({"error": "Serial client not connected"}), 503
    
    rack = serial_client.rack_manager.racks.get(rack_id)

    if not rack:
        return jsonify({"error": f"Rack {rack_id} not found"}), 404

    return jsonify({
        "rack_id": rack_id,
        "position": rack.position,
        "error": rack.error,
        "temperature": round(rack.temperature, 2),
        "humidity": round(rack.humidity, 2),
        "gas": round(rack.gas, 2),
        "last_update": str(rack.last_update),
        "status": "⚠️ ERROR" if rack.error else "✅ OK"
    })

@app.route("/api/history/<rack_id>")
def get_history(rack_id):
    """Lấy lịch sử dữ liệu sensor của một rack"""
    if not init_serial_client():
        return jsonify({"error": "Serial client not connected"}), 503
    
    rack = serial_client.rack_manager.racks.get(rack_id)

    if not rack:
        return jsonify([])

    history_list = list(rack.history)
    
    # Format dữ liệu với giá trị làm tròn
    formatted_history = []
    for item in history_list:
        formatted_history.append({
            "time": item["time"],
            "temperature": round(item["temperature"], 2),
            "humidity": round(item["humidity"], 2),
            "gas": round(item["gas"], 2)
        })

    return jsonify(formatted_history)

@app.route("/api/summary")
def get_summary():
    """Lấy tóm tắt thông tin từ tất cả racks"""
    if not init_serial_client():
        return jsonify({"error": "Serial client not connected"}), 503
    
    total_racks = len(serial_client.rack_manager.racks)
    error_count = sum(1 for rack in serial_client.rack_manager.racks.values() if rack.error)
    
    avg_temp = 0
    avg_humidity = 0
    max_gas = 0
    
    if total_racks > 0:
        temps = [rack.temperature for rack in serial_client.rack_manager.racks.values()]
        humidities = [rack.humidity for rack in serial_client.rack_manager.racks.values()]
        gases = [rack.gas for rack in serial_client.rack_manager.racks.values()]
        
        avg_temp = round(sum(temps) / len(temps), 2) if temps else 0
        avg_humidity = round(sum(humidities) / len(humidities), 2) if humidities else 0
        max_gas = round(max(gases), 2) if gases else 0

    return jsonify({
        "total_racks": total_racks,
        "error_racks": error_count,
        "avg_temperature": avg_temp,
        "avg_humidity": avg_humidity,
        "max_gas": max_gas
    })

# ===== UI =====
@app.route("/")
def index():
    return render_template("index.html")

# ===== HEALTH CHECK =====
@app.route("/health")
def health():
    """Health check endpoint"""
    status = "connected" if serial_client else "disconnected"
    return jsonify({"status": status})

# ===== RUN =====
if __name__ == "__main__":
    # Initialize serial client on startup
    init_serial_client()
    app.run(debug=False, host='0.0.0.0', port=5000, use_reloader=False)