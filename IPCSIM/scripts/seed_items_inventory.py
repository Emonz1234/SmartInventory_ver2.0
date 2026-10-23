"""Legacy local seeding is retired; master data belongs to Server."""
def seed():
    raise RuntimeError("Use Server/manage.py bootstrap_inventory; edge receives scoped MQTT sync. See docs/FIRST_TIME_CONFIG.md")

if __name__ == '__main__':
    seed()
