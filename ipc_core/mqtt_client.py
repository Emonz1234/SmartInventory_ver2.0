"""Transport configuration only; local business services do not import MQTT."""
def create_client(settings):
    import paho.mqtt.client as mqtt
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=settings.DEVICE_ID,
                         clean_session=False, manual_ack=True)
    client.username_pw_set(settings.DEVICE_ID, settings.MQTT_PASSWORD)
    if settings.MQTT_TLS:
        client.tls_set(ca_certs=settings.MQTT_CA or None)
    client.reconnect_delay_set(1, 30)
    return client
