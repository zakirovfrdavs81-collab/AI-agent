import os
import sqlite3
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATABASE_URL = (
    os.getenv("MIGRATION_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
).strip()
if not DATABASE_URL:
    raise SystemExit("Set DATABASE_URL or MIGRATION_DATABASE_URL before running this migration.")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

source_db = Path(os.getenv("NAVO_DB_PATH", str(PROJECT_ROOT / "backend" / "app.db")))
if not source_db.is_absolute():
    source_db = PROJECT_ROOT / source_db
if not source_db.is_file():
    raise SystemExit(f"SQLite source database was not found: {source_db}")

os.environ["DATABASE_URL"] = DATABASE_URL

from backend.main import db  # noqa: E402 - DATABASE_URL must be loaded before app initialization

TABLES = (
    "users",
    "codes",
    "sessions",
    "oauth_states",
    "pending_google_auth",
    "pending_login_auth",
    "usage",
    "conversations",
    "conversation_messages",
)
IDENTITY_TABLES = ("users", "conversations", "conversation_messages")


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def migrate():
    total_rows = 0
    with sqlite3.connect(source_db) as source:
        source.row_factory = sqlite3.Row
        source_tables = {
            row["name"]
            for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }

        with db() as target:
            occupied_tables = [
                table
                for table in TABLES
                if target.execute(f"SELECT COUNT(*) AS total FROM {table}").fetchone()["total"]
            ]
            if occupied_tables:
                raise RuntimeError(
                    "The PostgreSQL database is not empty; migration stopped to avoid overwriting data."
                )

            for table in TABLES:
                if table not in source_tables:
                    continue

                columns = [
                    row["name"]
                    for row in source.execute(f"PRAGMA table_info({quote_identifier(table)})")
                ]
                if not columns:
                    continue
                column_list = ", ".join(quote_identifier(column) for column in columns)
                placeholders = ", ".join("%s" for _ in columns)
                statement = (
                    f"INSERT INTO {quote_identifier(table)} ({column_list}) "
                    f"VALUES ({placeholders})"
                )
                cursor = source.execute(f"SELECT * FROM {quote_identifier(table)}")
                for row in cursor:
                    target.execute(statement, tuple(row))
                    total_rows += 1

            for table in IDENTITY_TABLES:
                target.execute(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id')::regclass, "
                    f"COALESCE(MAX(id), 1), COUNT(*) > 0) FROM {table}"
                )

    print(f"Migration complete: copied {total_rows} records into PostgreSQL.")


try:
    migrate()
except psycopg.Error as error:
    safe_message = str(error).replace(DATABASE_URL, "[redacted DATABASE_URL]")
    raise SystemExit(
        f"PostgreSQL migration failed ({type(error).__name__}): {safe_message}"
    ) from None
