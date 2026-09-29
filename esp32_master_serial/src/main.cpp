#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

// ===== LCD =====
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ===== DHT =====
#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// ===== MQ2 =====
#define MQ2_PIN 34
#define GAS_ALERT_THRESHOLD 2000

// ===== BUZZER =====
#define BUZZER_PIN 25

// ===== UART =====
#define RXD2 16
#define TXD2 17

// ===== SYSTEM =====
#define RACK_ID 1

unsigned long lastSend = 0;
unsigned long sendInterval = 5000;

void setup() {
  Serial.begin(115200);

  // UART to IPC
  Serial2.begin(115200, SERIAL_8N1, RXD2, TXD2);

  delay(1000);

  Serial.println("START SYSTEM");

  // I2C
  Wire.begin(21, 22);

  // LCD
  lcd.begin(16, 2);
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("SYSTEM START");

  // DHT
  dht.begin();
  delay(2000);

  // ===== BUZZER =====
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  lcd.clear();
  lcd.print("SYSTEM READY");

  delay(1500);
}

void loop() {
  unsigned long now = millis();

  if (now - lastSend >= sendInterval) {
    lastSend = now;

    // ===== READ SENSOR =====
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    int gas = analogRead(MQ2_PIN);

    bool gasAlert = (gas > GAS_ALERT_THRESHOLD);

    // dynamic interval
    sendInterval = gasAlert ? 2000 : 5000;

    // ===== DHT CHECK =====
    if (isnan(h) || isnan(t)) {
      Serial.println("DHT ERROR");

      lcd.clear();
      lcd.print("DHT ERROR");

      return;
    }

    // ===== LCD DISPLAY =====
    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("T:");
    lcd.print(t);

    lcd.print(" H:");
    lcd.print(h);

    lcd.setCursor(0, 1);

    if (gasAlert) {
      lcd.print("GAS ALERT!!!");
    } else {
      lcd.print("Gas:");
      lcd.print(gas);
    }

    // ===== BUZZER CONTROL =====
    // beep ngắt quãng dễ chịu hơn
    if (gasAlert) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(150);

      digitalWrite(BUZZER_PIN, LOW);
      delay(350);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }

    // ===== JSON PAYLOAD =====
    String payload = "{";

    payload += "\"rack_id\":" + String(RACK_ID) + ",";
    payload += "\"temperature\":" + String(t) + ",";
    payload += "\"humidity\":" + String(h) + ",";
    payload += "\"gas\":" + String(gas) + ",";
    payload += "\"gas_alert\":" + String(gasAlert ? "true" : "false");

    payload += "}";

    // ===== SEND VIA UART =====
    // Serial2.println(payload);

    // Serial.println("UART SENT:");
    Serial.println(payload);
  }
}