from sqlalchemy import create_engine
from sqlalchemy import inspect
from sqlalchemy import text
from sqlalchemy import event
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

from ipc_core.app.core.config import settings


DATABASE_URL = f"sqlite:///{settings.DB_PATH}" if settings.DB_PATH else "sqlite://"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


@event.listens_for(engine, "connect")
def configure_sqlite(connection, record):
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute("PRAGMA synchronous=FULL")


def ensure_schema():
    with engine.begin() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("CREATE TABLE IF NOT EXISTS core_schema_migrations(version INTEGER PRIMARY KEY)"))

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT OR IGNORE INTO core_schema_migrations VALUES(1)"))
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, additions in {
            'cabinets': {'description': "TEXT NOT NULL DEFAULT ''"},
            'items': {'category': "TEXT NOT NULL DEFAULT ''", 'description': "TEXT NOT NULL DEFAULT ''",
                      'is_active': 'INTEGER NOT NULL DEFAULT 1', 'is_demo': 'INTEGER NOT NULL DEFAULT 0'},
        }.items():
            columns = {column['name'] for column in inspect(conn).get_columns(table)}
            for name, declaration in additions.items():
                if name not in columns:
                    conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {declaration}'))
        conn.execute(text('INSERT OR IGNORE INTO core_schema_migrations VALUES(4)'))
    if "environment_snapshots" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("environment_snapshots")]
        with engine.begin() as conn:
            if "rack_id" not in columns:
                conn.execute(text("ALTER TABLE environment_snapshots ADD COLUMN rack_id integer"))
            if "created_at" not in columns:
                conn.execute(text("ALTER TABLE environment_snapshots ADD COLUMN created_at datetime"))
            if "gas" not in columns:
                conn.execute(text("ALTER TABLE environment_snapshots ADD COLUMN gas float"))
            conn.execute(text("INSERT OR IGNORE INTO core_schema_migrations VALUES(2)"))
            conn.execute(text("INSERT OR IGNORE INTO core_schema_migrations VALUES(3)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
