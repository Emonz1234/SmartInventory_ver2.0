"""Legacy local seeding is retired; master data belongs to Server."""
def seed():
    raise RuntimeError("Use Server/manage.py bootstrap_inventory; edge receives scoped MQTT sync. See docs/react-bootstrap.md")

if __name__ == '__main__':
    seed()
