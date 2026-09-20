"""
🔧 IPC Dashboard Configuration
"""

# ===== SERIAL CONFIGURATION =====
SERIAL_PORT = "COM5"
SERIAL_BAUD = 115200

# ===== SENSOR CONFIGURATION =====
# Ngưỡng cảnh báo
TEMP_HIGH_THRESHOLD = 50  # °C
TEMP_CRITICAL_THRESHOLD = 60  # °C

GAS_WARNING_THRESHOLD = 1000  # ppm
GAS_DANGER_THRESHOLD = 2000  # ppm

HUMIDITY_HIGH_THRESHOLD = 80  # %
HUMIDITY_LOW_THRESHOLD = 30  # %

# ===== DATA STORAGE =====
SENSOR_HISTORY_SIZE = 50  # Lưu trữ 50 mẫu gần nhất

# ===== DASHBOARD CONFIGURATION =====
DASHBOARD_UPDATE_INTERVAL = 2  # giây (phía client)
DASHBOARD_HOST = "0.0.0.0"
DASHBOARD_PORT = 5000
DEBUG_MODE = True

# ===== UI CONFIGURATION =====
# Hiển thị các units
UNIT_TEMPERATURE = "°C"
UNIT_HUMIDITY = "%"
UNIT_GAS = "ppm"

# Chart configuration
CHART_TYPE = "line"
CHART_ANIMATION = True
CHART_RESPONSIVE = True

# ===== LOGGING =====
LOG_LEVEL = "INFO"  # DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_FILE = "logs/ipc_dashboard.log"

# ===== TIMEZONE =====
TIMEZONE = "Asia/Ho_Chi_Minh"

print("[✅] Config loaded successfully")
