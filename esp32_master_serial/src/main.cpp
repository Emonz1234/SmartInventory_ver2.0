#include <Arduino.h>
#include <ESP32Servo.h>
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <cstring>
#include <cstdlib>

constexpr int SERVO_PIN=13, LIMIT_OPEN=32, LIMIT_CLOSE=33, LED_RED=26, BUZZER_PIN=25, MQ2_PIN=34;
constexpr int OPEN_PWM=1300, STOP_PWM=1500, CLOSE_PWM=1700, MQ2_THRESHOLD=2000;
constexpr unsigned long MOVE_TIMEOUT=5000;
constexpr int LOCAL_RACK=1;
Servo servo;
DHT dht(18, DHT22);
LiquidCrystal_I2C lcd(0x27,16,2);
enum RackState { UNKNOWN, CLOSED, OPENING, OPENED, CLOSING, STOPPED, ERROR };
RackState state=UNKNOWN;
const char* fault=nullptr;
unsigned long motionStarted=0, sensorRead=0, lcdUpdated=0;
int mq2=0;
float temperature=0, humidity=0;
char line[64];
size_t lineLength=0;
bool overflow=false;

const char* stateText() {
  static const char* names[]={"UNKNOWN","CLOSED","OPENING","OPENED","CLOSING","STOPPED","ERROR"};
  return names[state];
}
void stopServo() { servo.writeMicroseconds(STOP_PWM); }
void emitState() { Serial.printf("STATE %d %s\n",LOCAL_RACK,stateText()); }
void setState(RackState next) { state=next; emitState(); }
void reportError(int rack, const char* code) { Serial.printf("ERROR %d %s\n",rack,code); }
void latchError(const char* code) {
  stopServo();
  bool changed=state!=ERROR || !fault || strcmp(fault,code)!=0;
  fault=code; state=ERROR;
  digitalWrite(LED_RED,HIGH); digitalWrite(BUZZER_PIN,HIGH);
  if(changed) { reportError(LOCAL_RACK,code); emitState(); }
}
const char* hazard() {
  if(digitalRead(LIMIT_OPEN)==LOW && digitalRead(LIMIT_CLOSE)==LOW) return "LIMIT_CONFLICT";
  if(mq2>=MQ2_THRESHOLD) return "SMOKE_ALARM";
  return nullptr;
}
void checkSafety() {
  mq2=analogRead(MQ2_PIN);
  const char* danger=hazard();
  if(danger) latchError(danger);
}
RackState positionState() {
  if(digitalRead(LIMIT_OPEN)==LOW) return OPENED;
  if(digitalRead(LIMIT_CLOSE)==LOW) return CLOSED;
  return UNKNOWN;
}
void updateMotion() {
  if(state!=OPENING && state!=CLOSING) return;
  bool opening=state==OPENING;
  if(digitalRead(opening?LIMIT_OPEN:LIMIT_CLOSE)==LOW) {
    stopServo(); setState(opening?OPENED:CLOSED);
  } else if(millis()-motionStarted>=MOVE_TIMEOUT) latchError(opening?"OPEN_TIMEOUT":"CLOSE_TIMEOUT");
}
void processCommand(char* input) {
  char* save=nullptr;
  char* command=strtok_r(input," \t\r",&save);
  if(!command) return;
  char* id=strtok_r(nullptr," \t\r",&save);
  if(strcmp(command,"PING")==0 && !id) { Serial.println("PONG"); return; }
  char* end=nullptr;
  long rack=id?strtol(id,&end,10):0;
  if(!id || !*id || *end || rack<1 || rack>65535 || strtok_r(nullptr," \t\r",&save)) {
    reportError(0,"INVALID_COMMAND"); return;
  }
  // Future ESP-NOW routing belongs here. Never operate the local servo for another address.
  if(rack!=LOCAL_RACK) { reportError(rack,"INVALID_RACK"); return; }
  checkSafety(); updateMotion();
  if(strcmp(command,"STATUS")==0) {
    Serial.printf("STATUS %d %s %d %d %d\n",LOCAL_RACK,stateText(),digitalRead(LIMIT_OPEN)==LOW,digitalRead(LIMIT_CLOSE)==LOW,mq2);
    if(fault) reportError(LOCAL_RACK,fault);
    return;
  }
  bool opening=strcmp(command,"OPEN")==0, closing=strcmp(command,"CLOSE")==0;
  bool stopping=strcmp(command,"STOP")==0, resetting=strcmp(command,"RESET")==0;
  if(!opening && !closing && !stopping && !resetting) { reportError(rack,"INVALID_COMMAND"); return; }
  if((opening || closing) && fault) { reportError(rack,fault); emitState(); return; }
  if((opening || closing) && (state==OPENING || state==CLOSING)) {
    if((opening && state==OPENING)||(closing && state==CLOSING)) {
      Serial.printf("ACK %s %ld\n",command,rack); emitState();
    } else reportError(rack,"BUSY");
    return;
  }
  Serial.printf("ACK %s %ld\n",command,rack);
  if(stopping) { stopServo(); setState(fault?ERROR:STOPPED); return; }
  if(resetting) {
    stopServo();
    if(const char* danger=hazard()) { latchError(danger); reportError(rack,danger); emitState(); return; }
    fault=nullptr; digitalWrite(LED_RED,LOW); digitalWrite(BUZZER_PIN,LOW);
    setState(positionState()); return;
  }
  if(digitalRead(opening?LIMIT_OPEN:LIMIT_CLOSE)==LOW) { stopServo(); setState(opening?OPENED:CLOSED); return; }
  motionStarted=millis();
  setState(opening?OPENING:CLOSING);
  servo.writeMicroseconds(opening?OPEN_PWM:CLOSE_PWM);
}
void handleSerial() {
  // Bound work per loop so flooded Serial cannot starve safety or motion checks.
  for(int budget=0;budget<64 && Serial.available();++budget) {
    char c=Serial.read();
    if(c=='\n') {
      if(overflow) reportError(0,"INVALID_COMMAND");
      else { line[lineLength]='\0'; processCommand(line); }
      lineLength=0; overflow=false;
    } else if(c=='\0') overflow=true;
    else if(lineLength<sizeof(line)-1 && !overflow) line[lineLength++]=c;
    else overflow=true;
  }
}
void updateSensorsAndDisplay() {
  // DHT acquisition is deferred during motion to preserve fast limit/STOP response.
  if(state!=OPENING && state!=CLOSING && millis()-sensorRead>=2000) {
    sensorRead=millis();
    float t=dht.readTemperature(), h=dht.readHumidity();
    if(!isnan(t)) temperature=t;
    if(!isnan(h)) humidity=h;
    Serial.printf("{\"type\":\"telemetry\",\"rack_id\":1,\"temperature\":%.1f,\"humidity\":%.1f,\"gas\":%d,\"gas_alert\":%s}\n",temperature,humidity,mq2,mq2>=MQ2_THRESHOLD?"true":"false");
  }
  if(millis()-lcdUpdated>=1000) {
    lcdUpdated=millis();
    lcd.setCursor(0,0); lcd.print("T:"); lcd.print(temperature,1); lcd.print(" H:"); lcd.print(humidity,0); lcd.print("%   ");
    lcd.setCursor(0,1); lcd.print(stateText()); lcd.print("         ");
  }
}
void setup() {
  Serial.begin(115200);
  pinMode(LIMIT_OPEN,INPUT_PULLUP); pinMode(LIMIT_CLOSE,INPUT_PULLUP);
  pinMode(LED_RED,OUTPUT); pinMode(BUZZER_PIN,OUTPUT); pinMode(MQ2_PIN,INPUT);
  digitalWrite(LED_RED,LOW); digitalWrite(BUZZER_PIN,LOW);
  servo.setPeriodHertz(50); servo.attach(SERVO_PIN,500,2500); stopServo();
  dht.begin(); Wire.begin(21,23); Wire.setTimeOut(10); lcd.init(); lcd.backlight();
  state=positionState(); checkSafety(); emitState();
}
void loop() {
  checkSafety(); updateMotion(); handleSerial(); checkSafety(); updateMotion(); updateSensorsAndDisplay();
}
