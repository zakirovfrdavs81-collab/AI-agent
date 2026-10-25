"""Gemini Chat backend: email/SMS/Google auth, password reset and chat proxy.

Barcha maxfiy kalitlar (Gemini API key, SMTP, Eskiz, Google) faqat shu serverda
saqlanadi. Brauzerga hech qanday kalit yuborilmaydi va foydalanuvchi kalit
kiritishi shart emas.
"""

import asyncio
import base64
import binascii
import hashlib
import hmac
import html
import io
import json
import logging
import mimetypes
import os
import re
import secrets
import shutil
import smtplib
import sqlite3
import ssl
import time
import zipfile
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from typing import TypedDict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
import jwt
import psycopg
from dotenv import load_dotenv
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pwdlib import PasswordHash
from psycopg.rows import DictRow, dict_row

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = Path(__file__).resolve().parent
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
ROOT = PROJECT_ROOT
load_dotenv(PROJECT_ROOT / ".env")
os.environ.setdefault("FORWARDED_ALLOW_IPS", "*")


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url[len("postgres://"):]
    if not database_url.startswith("postgresql://"):
        return database_url

    parsed = urlsplit(database_url)
    query = parse_qsl(parsed.query, keep_blank_values=True)
    if not any(key.lower() == "sslmode" for key, _ in query):
        query.append(("sslmode", "require"))
    return urlunsplit(parsed._replace(query=urlencode(query)))


class SensitiveDataFilter(logging.Filter):
    PATTERNS = [
        (re.compile(r"(bearer\s+)[a-zA-Z0-9_\-\.]{15,}", re.IGNORECASE), r"\1***MASKED***"),
        (re.compile(r"(api[_\-]?key[=:\s]+)[a-zA-Z0-9_\-\.]{15,}", re.IGNORECASE), r"\1***MASKED***"),
        (re.compile(r"(password[=:\s]+)[^\s,;&'\"]+", re.IGNORECASE), r"\1***MASKED***"),
        (re.compile(r"(client_secret[=:\s]+)[^\s,;&'\"]+", re.IGNORECASE), r"\1***MASKED***"),
        (re.compile(r"(session[=:\s]+)[a-zA-Z0-9_\-\.]{25,}", re.IGNORECASE), r"\1***MASKED***"),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            for pattern, repl in self.PATTERNS:
                record.msg = pattern.sub(repl, record.msg)
        return True


for _logger_name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
    logging.getLogger(_logger_name).addFilter(SensitiveDataFilter())


ENVIRONMENT = (
    os.getenv("ENVIRONMENT") or os.getenv("ENV") or os.getenv("NODE_ENV") or "development"
).strip().lower()


def is_production() -> bool:
    if ENVIRONMENT in {"production", "prod"}:
        return True
    origin = (os.getenv("APP_ORIGIN") or os.getenv("RENDER_EXTERNAL_URL") or "").strip().lower()
    return origin.startswith("https://") and not ("localhost" in origin or "127.0.0.1" in origin)


def validate_database_configuration(database_url: str, require_database_url: bool, production: bool):
    if (require_database_url or production) and not database_url:
        raise RuntimeError(
            "DATABASE_URL is required in production; SQLite is disabled to prevent data loss. "
            "Add DATABASE_URL in Render Dashboard -> Environment, for example "
            "'postgresql://<user>:<password>@<host>:5432/<database>'."
        )


DB = Path(os.getenv("NAVO_DB_PATH", str(BACKEND_ROOT / "app.db")))
DATABASE_URL = normalize_database_url((os.getenv("DATABASE_URL") or "").strip())
require_database_url = (os.getenv("REQUIRE_DATABASE_URL") or "").strip().lower() in {
    "1", "true", "yes", "on"
}
validate_database_configuration(DATABASE_URL, require_database_url, is_production())
SESSION_DAYS = 30
CODE_TTL = 300
CODE_RESEND_SECONDS = 60
MAX_CODE_ATTEMPTS = 5
HOST = (os.getenv("HOST") or "0.0.0.0").strip()
try:
    PORT = int((os.getenv("PORT") or "5507").strip())
except ValueError:
    PORT = 5507

DAILY_MESSAGE_LIMIT = int(os.getenv("DAILY_MESSAGE_LIMIT", "30"))
APP_ORIGIN = (
    os.getenv("APP_ORIGIN")
    or os.getenv("RENDER_EXTERNAL_URL")
    or f"http://{'127.0.0.1' if HOST in {'0.0.0.0', ''} else HOST}:{PORT}"
).rstrip("/")
configured_frontend_origin = (os.getenv("FRONTEND_ORIGIN") or "").strip().rstrip("/")
FRONTEND_ORIGIN = (
    configured_frontend_origin
    if configured_frontend_origin and configured_frontend_origin != "*"
    else APP_ORIGIN
)
FRONTEND_APP_URL = f"{FRONTEND_ORIGIN}/app/"
GOOGLE_REDIRECT_URI = (
    os.getenv("GOOGLE_REDIRECT_URI", "").strip()
).rstrip("/")

configured_jwt_secret = (os.getenv("SESSION_SECRET") or "").strip()
insecure_secrets = {
    "",
    "generate-a-long-random-secret",
    "change-me",
    "secret",
    "your-session-secret-here",
}
if is_production():
    if not configured_jwt_secret or len(configured_jwt_secret) < 32 or configured_jwt_secret in insecure_secrets:
        raise RuntimeError(
            "CRITICAL: SESSION_SECRET is missing, too short, or set to an insecure default value in production. "
            "Server startup aborted."
        )
    JWT_SECRET = configured_jwt_secret
else:
    if len(configured_jwt_secret) >= 32 and configured_jwt_secret not in insecure_secrets:
        JWT_SECRET = configured_jwt_secret
    else:
        JWT_SECRET = secrets.token_urlsafe(48)
        logging.getLogger(__name__).warning(
            "SESSION_SECRET is missing or too short; temporary sessions will expire when the server restarts."
        )

password_hash = PasswordHash.recommended()
app = FastAPI(title="Gemini Chat")


def parse_cors_origins(value: str) -> list[str]:
    return sorted(
        {
            origin
            for candidate in value.split(",")
            if (origin := candidate.strip().rstrip("/")) and origin != "*"
        }
    )


cors_origins = parse_cors_origins(os.getenv("CORS_ALLOWED_ORIGINS") or "")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", include_in_schema=False)
@app.get("/api/health")
async def health():
    return {"status": "ok"}


app.mount("/css", StaticFiles(directory=FRONTEND_ROOT / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_ROOT / "js"), name="js")
if (FRONTEND_ROOT / "dist" / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ROOT / "dist" / "assets"), name="assets")

DIST = FRONTEND_ROOT / "dist"
DIST_MEDIA_TYPES = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
}


@app.get("/favicon.ico", include_in_schema=False)
@app.get("/logo.svg", include_in_schema=False)
@app.get("/logo-192.png", include_in_schema=False)
@app.get("/logo-512.png", include_in_schema=False)
@app.get("/maskable-192.png", include_in_schema=False)
@app.get("/maskable-512.png", include_in_schema=False)
@app.get("/apple-touch-icon.png", include_in_schema=False)
@app.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
@app.get("/offline.html", include_in_schema=False)
@app.get("/robots.txt", include_in_schema=False)
@app.get("/app/favicon.ico", include_in_schema=False)
@app.get("/app/logo.svg", include_in_schema=False)
@app.get("/app/logo-192.png", include_in_schema=False)
@app.get("/app/logo-512.png", include_in_schema=False)
@app.get("/app/maskable-192.png", include_in_schema=False)
@app.get("/app/maskable-512.png", include_in_schema=False)
@app.get("/app/apple-touch-icon.png", include_in_schema=False)
@app.get("/app/apple-touch-icon-precomposed.png", include_in_schema=False)
@app.get("/app/offline.html", include_in_schema=False)
async def dist_root_file(request: Request):
    """Logotip, favicon kabi dist yoki public ildizidagi fayllar."""
    name = Path(request.url.path).name
    target = DIST / name
    if not target.is_file():
        target = (FRONTEND_ROOT / "public") / name
    if not target.is_file():
        if name == "favicon.ico":
            if (DIST / "logo-192.png").is_file():
                target = DIST / "logo-192.png"
            elif ((FRONTEND_ROOT / "public") / "logo-192.png").is_file():
                target = (FRONTEND_ROOT / "public") / "logo-192.png"
        elif "apple-touch-icon" in name:
            if (DIST / "apple-touch-icon.png").is_file():
                target = DIST / "apple-touch-icon.png"
            elif (DIST / "logo-192.png").is_file():
                target = DIST / "logo-192.png"
            elif ((FRONTEND_ROOT / "public") / "logo-192.png").is_file():
                target = (FRONTEND_ROOT / "public") / "logo-192.png"
    if not target.is_file():
        raise HTTPException(404, "Fayl topilmadi.")
    return FileResponse(target, media_type=DIST_MEDIA_TYPES.get(target.suffix, "application/octet-stream"))


SHOWCASE = FRONTEND_ROOT / "showcase"
if (SHOWCASE / "index.html").is_file():
    # Taqdimot sahifasi: /showcase/ (statik, ilova API lariga ta'sir qilmaydi)
    app.mount("/showcase", StaticFiles(directory=SHOWCASE, html=True), name="showcase")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class SQLiteConnection(sqlite3.Connection):
    def __exit__(self, exception_type, exception, traceback):
        try:
            return super().__exit__(exception_type, exception, traceback)
        finally:
            self.close()


class PostgreSQLConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement: str, parameters=()):
        return self.connection.execute(statement.replace("?", "%s"), parameters)

    def executescript(self, script: str):
        for statement in script.split(";"):
            if statement.strip():
                self.execute(statement.strip())

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exception_type, exception, traceback):
        try:
            return self.connection.__exit__(exception_type, exception, traceback)
        finally:
            self.connection.close()


def db():
    if DATABASE_URL:
        connection = psycopg.Connection[DictRow].connect(
            DATABASE_URL,
            row_factory=dict_row,
            connect_timeout=15,
        )
        return PostgreSQLConnection(connection)
    connection = sqlite3.connect(DB, timeout=15, factory=SQLiteConnection)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_column(connection, table: str, column: str, definition: str):
    if DATABASE_URL:
        existing = {
            row["column_name"]
            for row in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema=current_schema() AND table_name=?",
                (table,),
            )
        }
    else:
        existing = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        if DATABASE_URL:
            connection.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}"
            )
        else:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def insert_id(connection, statement: str, parameters=()) -> int:
    if DATABASE_URL:
        row = connection.execute(f"{statement} RETURNING id", parameters).fetchone()
        return int(row["id"])
    return int(connection.execute(statement, parameters).lastrowid)


def recover_corrupted_sqlite_db() -> None:
    if DATABASE_URL or not DB.exists():
        return

    try:
        with sqlite3.connect(DB, timeout=15, factory=SQLiteConnection) as connection:
            connection.execute("PRAGMA schema_version")
        return
    except sqlite3.DatabaseError:
        backup_path = DB.with_name(f"{DB.name}.corrupt-{int(time.time())}")
        counter = 1
        while backup_path.exists():
            backup_path = DB.with_name(f"{DB.name}.corrupt-{int(time.time())}-{counter}")
            counter += 1

        try:
            shutil.move(str(DB), str(backup_path))
        except OSError:
            try:
                DB.unlink()
            except OSError:
                pass

        logging.getLogger(__name__).warning(
            "SQLite database %s is corrupted; backed up to %s and a fresh database will be created.",
            DB,
            backup_path,
        )


def init_db():
    if not DATABASE_URL:
        recover_corrupted_sqlite_db()

    with db() as connection:
        schema = """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                phone TEXT UNIQUE,
                password_hash TEXT,
                google_sub TEXT UNIQUE,
                verified INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS codes (
                destination TEXT PRIMARY KEY,
                code_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                purpose TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pending_google_auth (
                email TEXT PRIMARY KEY,
                google_sub TEXT NOT NULL,
                nickname TEXT,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pending_login_auth (
                email TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS usage (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                messages INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, day)
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS conversations_user_updated
                ON conversations(user_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                files_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id INTEGER PRIMARY KEY,
                settings_json TEXT NOT NULL DEFAULT '{}',
                starred_json TEXT NOT NULL DEFAULT '[]',
                drafts_json TEXT NOT NULL DEFAULT '{}',
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS conversation_messages_order
                ON conversation_messages(conversation_id, id);
            """
        if DATABASE_URL:
            schema = schema.replace(
                "INTEGER PRIMARY KEY AUTOINCREMENT",
                "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
            )
        connection.executescript(schema)
        ensure_column(connection, "users", "created_at", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(connection, "users", "nickname", "TEXT")
        ensure_column(connection, "users", "avatar", "TEXT")
        ensure_column(connection, "codes", "attempts", "INTEGER NOT NULL DEFAULT 0")


init_db()


class RegisterInput(BaseModel):
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    nickname: str | None = Field(default=None, min_length=2, max_length=40)


class ProfileInput(BaseModel):
    nickname: str = Field(min_length=2, max_length=40)
    avatar: str | None = Field(default=None, max_length=700_000)


class UserPreferencesInput(BaseModel):
    settings: dict[str, str | bool] | None = None
    starred_conversations: list[int] | None = Field(default=None, max_length=300)
    drafts: dict[str, str] | None = None


class LoginInput(BaseModel):
    identity: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class LoginOtpInput(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ForgotInput(BaseModel):
    destination: str = Field(min_length=1, max_length=254)


class CodeInput(BaseModel):
    destination: str
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    purpose: str = "register"


class ResetInput(BaseModel):
    destination: str
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=128)


class ResendInput(BaseModel):
    destination: str
    purpose: str = "register"


class ChatInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=30000)
    conversation_id: int | None = Field(default=None, ge=1)
    attachments: list["AttachmentInput"] = Field(default_factory=list, max_length=4)
    file_data: str | None = Field(default=None, max_length=16_777_216)
    file_type: str | None = Field(default=None, max_length=100)
    attachment_name: str | None = Field(default=None, max_length=255)


class AttachmentInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(default="application/octet-stream", max_length=100)
    data: str = Field(min_length=1, max_length=16_777_216)


class ConversationInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class ConversationTitleInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)


# --- Yordamchi funksiyalar ---------------------------------------------------

def normalize(value: str) -> str:
    value = (value or "").strip().lower()
    if "@" in value:
        return value
    digits = re.sub(r"[\s\-()]", "", value)
    if digits.startswith("998") and not digits.startswith("+"):
        digits = "+" + digits
    return digits


def identity_kind(value: str) -> str:
    if "@" in value:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", value):
            raise HTTPException(422, "Email manzilni to‘g‘ri kiriting (masalan: ism@gmail.com).")
        return "email"
    if not re.fullmatch(r"\+998\d{9}", value):
        raise HTTPException(422, "Telefon raqamini +998901234567 ko‘rinishida kiriting.")
    return "phone"


def channel_for(destination: str) -> str:
    """Kodni qaysi kanal orqali yuborish mumkin: 'sms', 'email' yoki 'demo'."""
    if dev_show_otp_enabled():
        return "demo"
    if destination.startswith("+"):
        ready = bool(os.getenv("ESKIZ_EMAIL") and os.getenv("ESKIZ_PASSWORD"))
        return "sms" if ready else "demo"
    return (
        "email"
        if email_delivery_configured() or is_production() or otp_mode() == "live"
        else "demo"
    )


def dev_show_otp_enabled() -> bool:
    if is_production():
        return False
    return (os.getenv("DEV_SHOW_OTP", "false") or "").strip().lower() in {
        "1", "true", "yes", "on"
    }


def client_ip(request: Request | None) -> str:
    if not request:
        return "127.0.0.1"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


def otp_mode() -> str:
    return (os.getenv("OTP_MODE", "auto") or "auto").strip().lower()


_attempts: dict[str, list[float]] = {}


def rate_limit(key: str, limit: int, window: int, message: str = "Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring."):
    now = time.time()
    hits = [stamp for stamp in _attempts.get(key, []) if now - stamp < window]
    if len(hits) >= limit:
        _attempts[key] = hits
        raise HTTPException(429, message)
    hits.append(now)
    _attempts[key] = hits


def public_user(user) -> dict:
    data = dict(user)
    email = data.get("email")
    phone = data.get("phone")
    return {
        "email": email,
        "phone": phone,
        "name": email.split("@")[0] if email else phone,
        "nickname": data.get("nickname") or "",
        "avatar": data.get("avatar") or "",
        "verified": bool(data.get("verified")),
        "created_at": int(data.get("created_at") or 0),
    }


def require_user(token: str | None):
    """Sessiyani talab qiladi. Bo'lmasa 401 xato ko'taradi."""
    user = session_user(token)
    if not user:
        raise HTTPException(401, "Bu amal uchun tizimga kirishingiz kerak.")
    return user


def session_user(token: str | None):
    if not token:
        return None
    try:
        claims = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp", "iat", "jti", "sub"]},
        )
        user_id = int(claims["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db() as connection:
        row = connection.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id "
            "WHERE sessions.token_hash=? AND sessions.user_id=? AND sessions.expires_at>?",
            (token_hash, user_id, int(time.time())),
        ).fetchone()
    return row


def create_session(user_id: int) -> str:
    now = int(time.time())
    expires_at = now + 60 * 60 * 24 * SESSION_DAYS
    token = jwt.encode(
        {
            "sub": str(user_id),
            "iat": now,
            "exp": expires_at,
            "jti": secrets.token_urlsafe(24),
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    with db() as connection:
        connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), user_id, expires_at),
        )
    return token


def start_session(response: Response, user_id: int, request: Request | None = None):
    token = create_session(user_id)
    is_https = False
    if request:
        proto = request.headers.get("x-forwarded-proto", "").lower()
        is_https = proto == "https" or request.url.scheme == "https"
    if not is_https:
        is_https = APP_ORIGIN.startswith("https://") or is_production()
    samesite = "none" if is_https and FRONTEND_ORIGIN != APP_ORIGIN else "lax"
    response.set_cookie(
        "session",
        token,
        httponly=True,
        secure=is_https,
        samesite=samesite,
        max_age=60 * 60 * 24 * SESSION_DAYS,
        path="/",
    )
    return token


def usage_today(user_id: int) -> int:
    with db() as connection:
        row = connection.execute(
            "SELECT messages FROM usage WHERE user_id=? AND day=?", (user_id, time.strftime("%Y-%m-%d"))
        ).fetchone()
    return int(row["messages"]) if row else 0


def add_usage(user_id: int):
    with db() as connection:
        connection.execute(
            "INSERT INTO usage(user_id, day, messages) VALUES (?, ?, 1) "
            "ON CONFLICT(user_id, day) DO UPDATE SET messages=messages+1",
            (user_id, time.strftime("%Y-%m-%d")),
        )


def find_user(destination: str):
    with db() as connection:
        return connection.execute(
            "SELECT * FROM users WHERE email=? OR phone=?", (destination, destination)
        ).fetchone()


# --- Tasdiqlash kodini yuborish ---------------------------------------------

async def send_sms(phone: str, code: str):
    email = os.getenv("ESKIZ_EMAIL")
    password = os.getenv("ESKIZ_PASSWORD")
    if not email or not password:
        raise HTTPException(503, "SMS xizmati sozlanmagan. .env fayliga ESKIZ_EMAIL va ESKIZ_PASSWORD kiriting.")
    async with httpx.AsyncClient(timeout=25) as client:
        token_response = await client.post(
            "https://notify.eskiz.uz/api/auth/login", data={"email": email, "password": password}
        )
        if token_response.status_code >= 400:
            raise HTTPException(502, "Eskiz SMS login ma’lumotlarini qabul qilmadi.")
        try:
            token = token_response.json().get("data", {}).get("token")
        except (AttributeError, ValueError):
            token = None
        if not token:
            raise HTTPException(502, "Eskiz SMS xizmati avtorizatsiya tokenini qaytarmadi.")
        response = await client.post(
            "https://notify.eskiz.uz/api/message/sms/send",
            headers={"Authorization": f"Bearer {token}"},
            data={"mobile_phone": phone.replace("+", ""), "message": f"Tasdiqlash kodi: {code}", "from": "4546"},
        )
        if response.status_code >= 400:
            try:
                detail = response.json().get("message", "SMS yuborilmadi.")
            except (AttributeError, ValueError):
                detail = "SMS yuborilmadi."
            raise HTTPException(502, f"SMS yuborilmadi: {detail}")


def get_email_provider() -> str:
    return (os.getenv("EMAIL_PROVIDER") or "smtp").strip().lower()


def get_smtp_config() -> tuple[str, str, str, int]:
    host = (os.getenv("SMTP_HOST") or "").strip().strip('"\'')
    user = (os.getenv("SMTP_USER") or os.getenv("SMTP_USERNAME") or "").strip().strip('"\'')
    password = (os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS") or "").strip().strip('"\'')
    password = re.sub(r"\s+", "", password)
    port_value = (os.getenv("SMTP_PORT") or "465").strip()
    try:
        port = int(port_value)
    except ValueError:
        port = 465
    return host, user, password, port


def email_delivery_configured() -> bool:
    provider = get_email_provider()
    if provider == "smtp":
        host, user, password, _ = get_smtp_config()
        return bool(host and user and password)
    if provider == "brevo":
        return bool(
            (os.getenv("BREVO_API_KEY") or "").strip()
            and (os.getenv("BREVO_SENDER_EMAIL") or "").strip()
        )
    if provider == "resend":
        return bool((os.getenv("RESEND_API_KEY") or "").strip())
    logging.error("Email error: EMAIL_PROVIDER must be 'smtp', 'resend', or 'brevo'")
    return False


def safe_email_error_value(value, secrets_to_mask: tuple[str, ...]) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    text = str(value) if value is not None else "-"
    for secret in secrets_to_mask:
        if secret:
            text = text.replace(secret, "***MASKED***")
    return re.sub(r"[\r\n\t]+", " ", text)[:1000]


def log_email_error(action: str, error: Exception, secrets_to_mask: tuple[str, ...]) -> None:
    code = getattr(error, "code", None) or getattr(error, "smtp_code", None) or getattr(error, "errno", None)
    response = getattr(error, "response", None)
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        response = error.response.text
    elif response is None:
        response = getattr(error, "smtp_error", None)
    message = getattr(error, "message", None) or str(error)
    logging.getLogger("uvicorn.error").error(
        "%s failed: type=%s code=%s response=%s message=%s",
        action,
        type(error).__name__,
        safe_email_error_value(code, secrets_to_mask),
        safe_email_error_value(response, secrets_to_mask),
        safe_email_error_value(message, secrets_to_mask),
    )


def smtp_log_secrets(user: str, password: str) -> tuple[str, ...]:
    raw_password = (os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS") or "").strip().strip('"\'')
    return tuple(secret for secret in (user, password, raw_password) if secret)


def verify_smtp_connection() -> bool:
    host, user, password, port = get_smtp_config()
    if not (host and user and password):
        logging.getLogger("uvicorn.error").warning(
            "SMTP verification skipped: SMTP_HOST, SMTP_USER, or SMTP_PASSWORD is missing"
        )
        return False

    context = ssl.create_default_context()
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as server:
                server.login(user, password)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.starttls(context=context)
                server.login(user, password)
        logging.getLogger("uvicorn.error").info(
            "SMTP connection verified successfully (%s:%s)", host, port
        )
        return True
    except Exception as error:
        log_email_error("SMTP verification", error, smtp_log_secrets(user, password))
        return False


def send_email(address: str, code: str) -> bool:
    provider = get_email_provider()
    host, user, password, port = get_smtp_config()
    brevo_api_key = (os.getenv("BREVO_API_KEY") or "").strip()
    brevo_sender = (os.getenv("BREVO_SENDER_EMAIL") or "").strip()
    resend_api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    resend_sender = (os.getenv("RESEND_SENDER_EMAIL") or "Navo AI <onboarding@resend.dev>").strip()

    if not email_delivery_configured():
        if provider == "brevo":
            logging.error("Email error: BREVO_API_KEY and BREVO_SENDER_EMAIL are required for Brevo delivery")
        elif provider == "resend":
            logging.error("Email error: RESEND_API_KEY is required for Resend delivery")
        elif provider == "smtp":
            logging.error("Email error: SMTP_HOST, SMTP_USER/SMTP_USERNAME, or SMTP_PASSWORD is not configured")
        return False

    message = EmailMessage()
    message["Subject"] = "🔐 Navo AI tasdiqlash kodi"
    if provider == "brevo":
        from_address = formataddr(("Navo AI", brevo_sender))
    elif provider == "resend":
        from_address = resend_sender if "<" in resend_sender else formataddr(("Navo AI", resend_sender))
    else:
        from_address = formataddr(("Navo AI", user))
    message["From"] = from_address
    message["To"] = address
    text_body = (
        f"Navo AI tasdiqlash kodi: {code}\n"
        "Kod 5 daqiqa amal qiladi. Xavfsizlik uchun kodni hech kimga bermang."
    )
    message.set_content(text_body)
    safe_code = html.escape(code)
    html_body = f"""\
<!doctype html>
<html lang="uz">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:28px 12px;background:#0a0b10;font-family:Arial,Helvetica,sans-serif;color:#f4f2fa">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#12131e;border:1px solid #29263c;border-radius:18px">
    <tr><td align="center" style="padding:32px 28px 14px">
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto">
        <tr><td align="center" valign="middle" width="38" height="38" style="width:38px;height:38px;border:1px solid #7965ca;border-radius:12px;background:#211d38;color:#e4dcff;font-size:21px;font-weight:bold">N</td>
        <td style="padding-left:10px;color:#dcd6f0;font-size:15px;font-weight:bold;letter-spacing:.4px">Navo AI <span style="color:#a99bff">🤖</span></td></tr>
      </table>
      <h1 style="margin:22px 0 10px;font-size:24px;color:#f4f2fa">Hisobingizni tasdiqlang</h1>
      <p style="margin:0;color:#b4b1c4;font-size:15px;line-height:1.7">Salom! Ro‘yxatdan o‘tishni yakunlash uchun ushbu kodni kiriting.</p>
    </td></tr>
    <tr><td align="center" style="padding:20px 28px">
      <div style="display:inline-block;padding:17px 25px;border:1px solid #7564c9;border-radius:13px;background:#1a1730;color:#d8ceff;font-size:32px;font-weight:bold;letter-spacing:9px">{safe_code}</div>
      <p style="margin:13px 0 0;color:#aaa3c0;font-size:13px">🔑 Tasdiqlash kodingiz</p>
    </td></tr>
    <tr><td align="center" style="padding:4px 28px 24px">
      <p style="margin:0;color:#c7c3d2;font-size:14px;line-height:1.7">⏳ Kod <strong>5 daqiqa</strong> amal qiladi.</p>
      <p style="margin:16px 0 0;color:#9290a3;font-size:12px;line-height:1.7">🛡️ Xavfsizlik uchun ushbu kodni hech kimga bermang. Agar bu so‘rov sizdan bo‘lmasa, xabarni e’tiborsiz qoldiring.</p>
    </td></tr>
  </table>
</body>
</html>
"""
    message.add_alternative(html_body, subtype="html")
    subject = "OTP"
    secrets_to_mask = (
        *smtp_log_secrets(user, password),
        brevo_api_key,
        brevo_sender,
        resend_api_key,
        resend_sender,
        address,
        code,
    )
    try:
        if provider == "resend":
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {resend_api_key}", "Content-Type": "application/json"},
                json={
                    "from": resend_sender,
                    "to": [address],
                    "subject": subject,
                    "text": text_body,
                    "html": html_body,
                },
                timeout=20,
            )
            response.raise_for_status()
        elif provider == "brevo":
            response = httpx.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={
                    "accept": "application/json",
                    "Content-Type": "application/json",
                    "api-key": brevo_api_key,
                },
                json={
                    "sender": {"name": "Navo AI", "email": brevo_sender},
                    "to": [{"email": address}],
                    "subject": subject,
                    "htmlContent": html_body,
                },
                timeout=20,
            )
            response_body = safe_email_error_value(response.text, secrets_to_mask)
            if 200 <= response.status_code < 300:
                logging.getLogger("uvicorn.error").info(
                    "Brevo email response: status=%s body=%s",
                    response.status_code,
                    response_body,
                )
            else:
                if response.status_code == 401:
                    category = "invalid_or_revoked_api_key"
                elif response.status_code == 400:
                    category = "invalid_request_or_unverified_sender"
                elif response.status_code == 403:
                    category = "IP_restriction_or_account_access"
                else:
                    category = "provider_rejected_request"
                logging.getLogger("uvicorn.error").error(
                    "Brevo email rejected: status=%s category=%s body=%s",
                    response.status_code,
                    category,
                    response_body,
                )
                return False
        elif provider == "smtp" and port == 465:
            with smtplib.SMTP_SSL(
                host, port, timeout=20, context=ssl.create_default_context()
            ) as server:
                server.login(user, password)
                server.send_message(message)
        elif provider == "smtp":
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.starttls(context=ssl.create_default_context())
                server.login(user, password)
                server.send_message(message)
        return True
    except Exception as error:
        log_email_error(
            "Email delivery",
            error,
            secrets_to_mask,
        )
        return False


@app.on_event("startup")
async def verify_email_transport_on_startup():
    logger = logging.getLogger("uvicorn.error")
    validate_database_configuration(DATABASE_URL, require_database_url, is_production())

    provider = get_email_provider()
    if provider == "brevo":
        api_key_configured = bool((os.getenv("BREVO_API_KEY") or "").strip())
        sender_configured = bool((os.getenv("BREVO_SENDER_EMAIL") or "").strip())
        logger.info(
            "Email configuration: EMAIL_PROVIDER=brevo BREVO_API_KEY=%s BREVO_SENDER_EMAIL=%s",
            "configured" if api_key_configured else "missing",
            "configured" if sender_configured else "missing",
        )
        if not api_key_configured or not sender_configured:
            missing_settings = [
                name
                for name, configured in (
                    ("BREVO_API_KEY", api_key_configured),
                    ("BREVO_SENDER_EMAIL", sender_configured),
                )
                if not configured
            ]
            logger.warning(
                "Brevo email is not configured: missing %s",
                ", ".join(missing_settings),
            )
        else:
            logger.info("Email transport configured: EMAIL_PROVIDER=brevo (HTTPS API)")
    elif provider == "smtp":
        await asyncio.to_thread(verify_smtp_connection)
    elif provider == "resend":
        if email_delivery_configured():
            logger.info(
                "Email transport verified: EMAIL_PROVIDER is %s (HTTP API configured)", provider
            )
        else:
            logger.warning(
                "Email transport warning: EMAIL_PROVIDER is %s but required API credentials are missing", provider
            )
    else:
        logger.warning(
            "Email transport warning: EMAIL_PROVIDER '%s' is unsupported or not configured", provider
        )


def drop_code(destination: str):
    with db() as connection:
        connection.execute("DELETE FROM codes WHERE destination=?", (destination,))


async def issue_code(
    destination: str, purpose: str, require_email: bool = False
) -> tuple[str | None, bool]:
    """Kod yaratadi va mavjud bo'lsa real kanal orqali yuboradi.

    Eskiz yoki Gmail sozlanmagan bo'lsa kod demo rejimida qaytariladi, shunda
    sayt hech qanday tashqi xizmatsiz ham ishlayveradi (OTP_MODE=live bilan
    o'chirib qo'yish mumkin).
    """
    destination = normalize(destination)
    channel = "email" if require_email else channel_for(destination)
    if require_email and not email_delivery_configured():
        logging.error("Email error: required email provider is not configured")
        return None, False
    connection = db()
    try:
        connection.execute("DELETE FROM codes WHERE expires_at < ?", (int(time.time()),))
        row = connection.execute("SELECT expires_at FROM codes WHERE destination=?", (destination,)).fetchone()
        if row and row["expires_at"] > time.time() + CODE_TTL - CODE_RESEND_SECONDS:
            raise HTTPException(429, "Kod yaqinda yuborilgan. Bir daqiqadan so‘ng qayta urinib ko‘ring.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        connection.execute(
            "INSERT INTO codes (destination, code_hash, expires_at, purpose, attempts) "
            "VALUES (?, ?, ?, ?, 0) "
            "ON CONFLICT(destination) DO UPDATE SET "
            "code_hash=excluded.code_hash, expires_at=excluded.expires_at, "
            "purpose=excluded.purpose, attempts=0",
            (destination, hashlib.sha256(code.encode()).hexdigest(), int(time.time()) + CODE_TTL, purpose),
        )
        connection.commit()
    finally:
        connection.close()
    try:
        if channel == "sms":
            await send_sms(destination, code)
        elif channel == "email":
            email_sent = await asyncio.to_thread(send_email, destination, code)
            if not email_sent:
                drop_code(destination)
                return None, False
        elif otp_mode() == "live":
            raise HTTPException(503, "Tasdiqlash kodi yuboriladigan xizmat sozlanmagan. Administrator .env faylini to‘ldirishi kerak.")
    except (HTTPException, httpx.HTTPError, OSError, smtplib.SMTPException):
        drop_code(destination)
        raise
    if dev_show_otp_enabled():
        logging.getLogger("uvicorn.error").warning(
            "DEV_SHOW_OTP=true: %s OTP code: %s", purpose, code
        )
    return code, True


def check_code(destination: str, code: str, purpose: str):
    """Kodni tekshiradi. Xato bo'lsa HTTPException ko'taradi."""
    connection = db()
    try:
        row = connection.execute("SELECT * FROM codes WHERE destination=?", (destination,)).fetchone()
        if not row or row["purpose"] != purpose or row["expires_at"] < time.time():
            raise HTTPException(400, "Kod muddati tugagan yoki topilmadi. Yangi kod so‘rang.")
        if not hmac.compare_digest(hashlib.sha256(code.strip().encode()).hexdigest(), row["code_hash"]):
            attempts = int(row["attempts"]) + 1
            if attempts >= MAX_CODE_ATTEMPTS:
                connection.execute("DELETE FROM codes WHERE destination=?", (destination,))
                connection.commit()
                raise HTTPException(429, "Kod juda ko‘p marta xato kiritildi. Yangi kod so‘rang.")
            connection.execute("UPDATE codes SET attempts=? WHERE destination=?", (attempts, destination))
            connection.commit()
            raise HTTPException(400, f"Kod noto‘g‘ri. Yana {MAX_CODE_ATTEMPTS - attempts} ta urinish qoldi.")
        connection.execute("DELETE FROM codes WHERE destination=?", (destination,))
        connection.commit()
    finally:
        connection.close()


def channel_label(channel: str) -> str:
    return {"sms": "SMS orqali", "email": "email orqali"}.get(channel, "ekranda ko‘rsatildi")


def google_ready() -> bool:
    return bool(
        os.getenv("GOOGLE_CLIENT_ID")
        and os.getenv("GOOGLE_CLIENT_SECRET")
        and GOOGLE_REDIRECT_URI
    )


# --- Sahifalar va sozlamalar -------------------------------------------------

def frontend_page() -> Path:
    """Return the built React entry point for the authenticated application."""
    built_page = FRONTEND_ROOT / "dist" / "index.html"
    if not built_page.is_file():
        raise HTTPException(
            status_code=503,
            detail="Frontend build topilmadi. `npm run build` ni bajarib, serverni qayta ishga tushiring.",
        )
    return built_page


@app.get("/")
async def index():
    return FileResponse(SHOWCASE / "index.html")


@app.get("/privacy", response_class=HTMLResponse)
async def privacy_policy():
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Privacy Policy — Navo AI</title></head><body>"
        "<main><h1>Privacy Policy</h1>"
        "<p>Navo AI foydalanuvchi ma'lumotini qo'riqlab oladi. "
        "Navo AI xat orqali tasdiqlash kodlarini, sessiya ma'lumotlarini "
        "va foydalanuvchi shaxsiy ma'lumotlarini ishlatadi.</p>"
        "</main></body></html>"
    )


@app.get("/app")
async def app_redirect():
    return FileResponse(frontend_page())


@app.get("/app/")
async def application():
    return FileResponse(frontend_page())


@app.get("/manifest.webmanifest")
@app.get("/sw.js")
async def pwa_file(request: Request):
    name = Path(request.url.path).name
    target = DIST / name
    if not target.is_file():
        target = (FRONTEND_ROOT / "public") / name
    if not target.is_file():
        raise HTTPException(404, "PWA fayli topilmadi.")
    headers = {"Cache-Control": "no-cache"}
    if name == "sw.js":
        headers["Service-Worker-Allowed"] = "/"
    return FileResponse(
        target,
        media_type="application/manifest+json" if name == "manifest.webmanifest" else "application/javascript",
        headers=headers,
    )


@app.get("/api/config")
async def config():
    """Frontend qaysi kirish usullari yoqilganini shu yerdan biladi."""
    sms_ready = bool(os.getenv("ESKIZ_EMAIL") and os.getenv("ESKIZ_PASSWORD"))
    email_ready = email_delivery_configured()
    return {
        "google_login": google_ready(),
        "sms_channel": "sms" if sms_ready else "demo",
        "email_channel": "email" if email_ready else "demo",
        "otp_resend_seconds": CODE_RESEND_SECONDS,
        "daily_limit": DAILY_MESSAGE_LIMIT,
        "session_days": SESSION_DAYS,
    }


@app.get("/api/me")
async def me(session: str | None = Cookie(default=None)):
    user = session_user(session)
    if not user:
        return {"authenticated": False, "daily_limit": DAILY_MESSAGE_LIMIT}
    return {
        "authenticated": True,
        "user": public_user(user),
        "used_today": usage_today(user["id"]),
        "daily_limit": DAILY_MESSAGE_LIMIT,
    }


@app.post("/api/auth/logout")
async def logout(response: Response, request: Request, session: str | None = Cookie(default=None)):
    if session:
        with db() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(session.encode()).hexdigest(),)
            )
    proto = request.headers.get("x-forwarded-proto", "").lower()
    is_https = (
        proto == "https"
        or request.url.scheme == "https"
        or APP_ORIGIN.startswith("https://")
        or is_production()
    )
    samesite = "none" if is_https and FRONTEND_ORIGIN != APP_ORIGIN else "lax"
    response.delete_cookie(
        "session",
        path="/",
        httponly=True,
        secure=is_https,
        samesite=samesite,
    )
    return {"message": "Siz hisobdan chiqdingiz."}


# --- Ro'yxatdan o'tish va kirish --------------------------------------------

def registration_email_failure_message() -> str:
    if get_email_provider() == "brevo":
        if not email_delivery_configured():
            return (
                "Hisob yaratildi, ammo tasdiqlash emaili yuborilmadi: "
                "Brevo sozlamalarida BREVO_API_KEY yoki BREVO_SENDER_EMAIL yo‘q."
            )
        return (
            "Hisob yaratildi, ammo Brevo tasdiqlash emailini yubormadi. "
            "Render logidagi Brevo statusi va javobini tekshirib, kodni qayta yuboring."
        )
    return (
        "Hisob yaratildi, ammo tasdiqlash emaili yuborilmadi. "
        "Email xizmati sozlamalarini tekshirib, kodni qayta yuboring."
    )


@app.post("/api/auth/register")
async def register(payload: RegisterInput, request: Request):
    destination = normalize(payload.email or payload.phone or "")
    if not destination:
        raise HTTPException(400, "Email yoki telefon raqamini kiriting.")
    is_email = identity_kind(destination) == "email"
    rate_limit(
        f"register:{destination}",
        5,
        900,
        "Bu manzil uchun juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring.",
    )
    rate_limit(
        f"ip:register:{client_ip(request)}",
        15,
        900,
        "Juda ko‘p ro‘yxatdan o‘tish urinishi. 15 daqiqadan so‘ng qayta urinib ko‘ring.",
    )
    existing = find_user(destination)
    if existing and existing["verified"]:
        raise HTTPException(409, "Bu hisob allaqachon mavjud. «Kirish» bo‘limidan foydalaning.")
    nickname = (payload.nickname or "").strip()[:40] or None
    password_digest = await asyncio.to_thread(password_hash.hash, payload.password)
    with db() as connection:
        if existing:
            connection.execute(
                "UPDATE users SET password_hash=?, nickname=COALESCE(?, nickname) WHERE id=?",
                (password_digest, nickname, existing["id"]),
            )
        else:
            connection.execute(
                "INSERT INTO users(email, phone, password_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    destination if is_email else None,
                    None if is_email else destination,
                    password_digest,
                    nickname,
                    int(time.time()),
                ),
            )
    email_failure_message = None
    try:
        code, email_sent = await issue_code(destination, "register")
    except HTTPException as error:
        if not is_email or error.status_code not in {502, 503}:
            raise
        logging.getLogger("uvicorn.error").error("Registration email delivery failed: %s", error.detail)
        code, email_sent = None, False
        email_failure_message = error.detail
    channel = (
        "email"
        if is_email and not email_sent and code is None
        else channel_for(destination)
    )
    if channel == "email" and not email_sent:
        message = email_failure_message or registration_email_failure_message()
    else:
        message = (
            f"Tasdiqlash kodi {channel_label(channel)} yuborildi."
            if channel != "demo"
            else "Tasdiqlash kodi yaratildi. Quyidagi kodni kiriting."
        )
    return {
        "success": True,
        "message": message,
        "destination": destination,
        "channel": channel,
        "email_sent": email_sent if channel == "email" else None,
        "demo_code": code if (channel == "demo" and not is_production() and dev_show_otp_enabled()) else None,
    }


@app.post("/api/auth/verify")
@app.post("/api/auth/verify-otp")
async def verify_code(payload: CodeInput, response: Response, request: Request):
    destination = normalize(payload.destination)
    identity_kind(destination)
    rate_limit(f"verify:{destination}", 20, 900)
    rate_limit(f"ip:verify:{client_ip(request)}", 50, 900)
    google_pending: tuple[str, str | None] | None = None
    if payload.purpose == "google":
        with db() as connection:
            pending_row = connection.execute(
                "SELECT * FROM pending_google_auth WHERE email=? AND expires_at>?",
                (destination, int(time.time())),
            ).fetchone()
        if not pending_row:
            raise HTTPException(400, "Google tasdiqlash muddati tugagan. Google orqali qayta kiring.")
        google_pending = (str(pending_row["google_sub"]), pending_row["nickname"])
    check_code(destination, payload.code, payload.purpose)
    if payload.purpose == "google":
        if google_pending is None:
            raise HTTPException(400, "Google tasdiqlash muddati tugagan. Google orqali qayta kiring.")
        google_sub, google_nickname = google_pending
        with db() as connection:
            by_google = connection.execute(
                "SELECT * FROM users WHERE google_sub=?", (google_sub,)
            ).fetchone()
            by_email = connection.execute(
                "SELECT * FROM users WHERE email=?", (destination,)
            ).fetchone()
            if by_google and by_email and by_google["id"] != by_email["id"]:
                raise HTTPException(409, "Bu Google hisobi boshqa Navo AI hisobiga bog‘langan.")
            if by_email and by_email["google_sub"] and by_email["google_sub"] != google_sub:
                raise HTTPException(409, "Bu email boshqa Google hisobi bilan bog‘langan.")
            if by_google:
                connection.execute(
                    "UPDATE users SET email=?, verified=1, nickname=COALESCE(nickname, ?) WHERE id=?",
                    (destination, google_nickname, by_google["id"]),
                )
                user_id = by_google["id"]
            elif by_email:
                connection.execute(
                    "UPDATE users SET google_sub=?, verified=1, nickname=COALESCE(nickname, ?) WHERE id=?",
                    (google_sub, google_nickname, by_email["id"]),
                )
                user_id = by_email["id"]
            else:
                user_id = insert_id(
                    connection,
                    "INSERT INTO users(email, google_sub, verified, nickname, created_at) "
                    "VALUES (?, ?, 1, ?, ?)",
                    (destination, google_sub, google_nickname, int(time.time())),
                )
            connection.execute("DELETE FROM pending_google_auth WHERE email=?", (destination,))
            user = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        access_token = start_session(response, user["id"], request)
        return {
            "message": "Google hisobi tasdiqlandi.",
            "user": public_user(user),
            "access_token": access_token,
            "token_type": "bearer",
        }
    user = find_user(destination)
    if not user:
        raise HTTPException(404, "Bu manzil uchun hisob topilmadi. Qayta ro‘yxatdan o‘ting.")
    with db() as connection:
        connection.execute("UPDATE users SET verified=1 WHERE id=?", (user["id"],))
    user = find_user(destination)
    access_token = start_session(response, user["id"], request)
    message = "Hisob tasdiqlandi." if payload.purpose == "register" else "Kod tasdiqlandi."
    return {
        "message": message,
        "user": public_user(user),
        "access_token": access_token,
        "token_type": "bearer",
    }


@app.post("/api/auth/login")
async def login(payload: LoginInput, response: Response, request: Request):
    identity = normalize(payload.identity)
    if not identity:
        raise HTTPException(400, "Email yoki telefon raqamini kiriting.")
    rate_limit(
        f"login:{identity}", 10, 900, "Login urinishlari ko‘payib ketdi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    rate_limit(
        f"ip:login:{client_ip(request)}", 30, 900, "Bu qurilmadan juda ko‘p login urinishi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    user = find_user(identity)
    valid_password = False
    if user and user["password_hash"]:
        try:
            valid_password = password_hash.verify(payload.password, user["password_hash"])
        except Exception:  # noqa: BLE001 - buzilgan hash ham shunchaki "noto'g'ri parol" hisoblanadi
            valid_password = False
    if not user or not valid_password:
        raise HTTPException(401, "Login yoki parol noto‘g‘ri.")
    if not user["verified"]:
        raise HTTPException(403, "Hisob hali tasdiqlanmagan. Kodni kiritib tasdiqlang.")
    email = normalize(user["email"] or "")
    if not email:
        raise HTTPException(400, "Ikki bosqichli kirish uchun akkauntingizga tasdiqlangan email bog‘langan bo‘lishi kerak.")
    try:
        _, email_sent = await issue_code(email, "login", require_email=True)
    except HTTPException as error:
        if error.status_code != 429:
            raise
        with db() as connection:
            active_code = connection.execute(
                "SELECT 1 FROM codes WHERE destination=? AND purpose='login' AND expires_at>?",
                (email, int(time.time())),
            ).fetchone()
        if not active_code:
            raise
        email_sent = True
    if not email_sent:
        raise HTTPException(
            502,
            "Tasdiqlash emaili yuborilmadi. Server logidagi SMTP yoki email provayderi xatosini tekshiring.",
        )
    with db() as connection:
        connection.execute(
            "INSERT INTO pending_login_auth(email, user_id, expires_at) VALUES (?, ?, ?) "
            "ON CONFLICT(email) DO UPDATE SET "
            "user_id=excluded.user_id, expires_at=excluded.expires_at",
            (email, user["id"], int(time.time()) + CODE_TTL),
        )
    return {
        "require_otp": True,
        "email": email,
        "message": f"Kod {email} manziliga yuborildi.",
    }


@app.post("/api/auth/verify-login-otp")
async def verify_login_otp(payload: LoginOtpInput, response: Response, request: Request):
    email = normalize(payload.email)
    if identity_kind(email) != "email":
        raise HTTPException(422, "Email manzilni to‘g‘ri kiriting.")
    rate_limit(f"verify-login:{email}", 20, 900)
    rate_limit(f"ip:verify-login:{client_ip(request)}", 50, 900)
    with db() as connection:
        pending = connection.execute(
            "SELECT pending_login_auth.user_id, users.* FROM pending_login_auth "
            "JOIN users ON users.id=pending_login_auth.user_id "
            "WHERE pending_login_auth.email=? AND pending_login_auth.expires_at>?",
            (email, int(time.time())),
        ).fetchone()
    if not pending:
        raise HTTPException(400, "Kirish so‘rovi muddati tugagan. Email va parolni qayta kiriting.")
    check_code(email, payload.code, "login")
    with db() as connection:
        connection.execute("DELETE FROM pending_login_auth WHERE email=?", (email,))
    access_token = start_session(response, pending["user_id"], request)
    user = find_user(email)
    return {
        "message": "Kirish muvaffaqiyatli.",
        "user": public_user(user),
        "used_today": usage_today(user["id"]),
        "daily_limit": DAILY_MESSAGE_LIMIT,
        "access_token": access_token,
        "token_type": "bearer",
    }


# --- Parolni tiklash ---------------------------------------------------------

@app.post("/api/auth/forgot")
async def forgot(payload: ForgotInput, request: Request):
    destination = normalize(payload.destination)
    identity_kind(destination)
    if not find_user(destination):
        raise HTTPException(404, "Bunday hisob topilmadi. Avval ro‘yxatdan o‘ting.")
    rate_limit(
        f"forgot:{destination}", 5, 900, "Kod juda ko‘p marta so‘raldi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    rate_limit(
        f"ip:forgot:{client_ip(request)}", 15, 900, "Juda ko‘p tiklash so‘rovi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    code, email_sent = await issue_code(destination, "reset")
    channel = channel_for(destination)
    if channel == "email" and not email_sent:
        return {
            "success": False,
            "message": "Tiklash kodi emailga yuborilmadi. Serverdagi email xizmati sozlamalarini tekshiring.",
            "destination": destination,
            "channel": channel,
            "email_sent": False,
            "demo_code": None,
        }
    return {
        "message": f"Parolni tiklash kodi {channel_label(channel)} yuborildi."
        if channel != "demo"
        else "Tiklash kodi yaratildi. Quyidagi kodni kiriting.",
        "destination": destination,
        "channel": channel,
        "email_sent": email_sent if channel == "email" else None,
        "demo_code": code if (channel == "demo" and not is_production() and dev_show_otp_enabled()) else None,
    }


@app.post("/api/auth/resend")
@app.post("/api/auth/resend-otp")
async def resend(payload: ResendInput, request: Request):
    destination = normalize(payload.destination)
    kind = identity_kind(destination)
    purpose = payload.purpose
    if purpose not in {"register", "reset", "google", "login"}:
        raise HTTPException(400, "Tasdiqlash kodi maqsadi noto‘g‘ri.")
    if purpose == "google":
        if kind != "email":
            raise HTTPException(400, "Google tasdiqlash kodi emailga yuboriladi.")
        with db() as connection:
            pending = connection.execute(
                "SELECT 1 FROM pending_google_auth WHERE email=? AND expires_at>?",
                (destination, int(time.time())),
            ).fetchone()
        if not pending:
            raise HTTPException(404, "Google tasdiqlash so‘rovi topilmadi. Google orqali qayta kiring.")
    elif purpose == "login":
        if kind != "email":
            raise HTTPException(400, "Kirish tasdiqlash kodi emailga yuboriladi.")
        with db() as connection:
            pending = connection.execute(
                "SELECT 1 FROM pending_login_auth WHERE email=? AND expires_at>?",
                (destination, int(time.time())),
            ).fetchone()
        if not pending:
            raise HTTPException(404, "Kirish tasdiqlash so‘rovi topilmadi. Email va parol bilan qayta kiring.")
    else:
        user = find_user(destination)
        if not user:
            raise HTTPException(404, "Bunday hisob topilmadi. Avval ro‘yxatdan o‘ting.")
        if purpose == "reset" and not user["verified"]:
            raise HTTPException(403, "Avval hisobni tasdiqlang, keyin parolni tiklang.")
    rate_limit(
        f"resend:{destination}", 5, 900, "Kod juda ko‘p marta so‘raldi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    rate_limit(
        f"ip:resend:{client_ip(request)}", 15, 900, "Juda ko‘p kod so‘rovi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    code, email_sent = await issue_code(
        destination, purpose, require_email=purpose in {"google", "login"}
    )
    channel = "email" if purpose in {"google", "login"} else channel_for(destination)
    if channel == "email" and not email_sent:
        return {
            "success": False,
            "message": "Tasdiqlash emaili yuborilmadi. Serverdagi email xizmati sozlamalarini tekshiring.",
            "destination": destination,
            "channel": channel,
            "email_sent": False,
            "demo_code": None,
        }
    if purpose == "google":
        with db() as connection:
            connection.execute(
                "UPDATE pending_google_auth SET expires_at=? WHERE email=?",
                (int(time.time()) + CODE_TTL * 2, destination),
            )
    elif purpose == "login":
        with db() as connection:
            connection.execute(
                "UPDATE pending_login_auth SET expires_at=? WHERE email=?",
                (int(time.time()) + CODE_TTL, destination),
            )
    return {
        "message": f"Yangi kod {channel_label(channel)} yuborildi."
        if channel != "demo"
        else "Yangi kod yaratildi. Quyidagi kodni kiriting.",
        "destination": destination,
        "channel": channel,
        "email_sent": email_sent if channel == "email" else None,
        "demo_code": code if (channel == "demo" and not is_production() and dev_show_otp_enabled()) else None,
    }


@app.post("/api/auth/reset")
async def reset(payload: ResetInput, request: Request):
    destination = normalize(payload.destination)
    identity_kind(destination)
    rate_limit(f"reset:{destination}", 10, 900)
    rate_limit(f"ip:reset:{client_ip(request)}", 25, 900)
    user = find_user(destination)
    if not user:
        raise HTTPException(404, "Bunday hisob topilmadi.")
    check_code(destination, payload.code, "reset")
    password_digest = await asyncio.to_thread(password_hash.hash, payload.password)
    with db() as connection:
        connection.execute(
            "UPDATE users SET password_hash=?, verified=1 WHERE id=?",
            (password_digest, user["id"]),
        )
        connection.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    return {"message": "Parol yangilandi. Endi yangi parol bilan kiring."}


# --- Google orqali kirish ----------------------------------------------------

@app.get("/api/auth/google")
async def google_start():
    logging.getLogger("uvicorn.error").info(
        "Google OAuth Redirect URI: %s",
        GOOGLE_REDIRECT_URI or "(not configured)",
    )
    if not google_ready():
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error=google_config")
    state = secrets.token_urlsafe(24)
    with db() as connection:
        connection.execute("INSERT INTO oauth_states VALUES (?, ?)", (state, int(time.time()) + 600))
    query = httpx.QueryParams(
        {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "select_account",
            "state": state,
        }
    )
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{query}")


@app.get("/api/auth/google/callback")
@app.get("/api/auth/callback/google")
async def google_callback(request: Request, code: str = "", state: str = ""):
    logging.getLogger("uvicorn.error").info(
        "Google OAuth callback Redirect URI: %s",
        GOOGLE_REDIRECT_URI or "(not configured)",
    )
    if not google_ready():
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error=google_config")
    with db() as connection:
        valid = connection.execute(
            "SELECT state FROM oauth_states WHERE state=? AND expires_at>?", (state, int(time.time()))
        ).fetchone()
        connection.execute("DELETE FROM oauth_states WHERE state=?", (state,))
    if not valid or not code:
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error=google_state")
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "redirect_uri": GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
            )
            token_response.raise_for_status()
            id_token = token_response.json().get("id_token")
            if not id_token:
                raise httpx.HTTPStatusError(
                    "Google token response did not include an ID token.",
                    request=token_response.request,
                    response=token_response,
                )
            profile = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": id_token})
            profile.raise_for_status()
            google_user = profile.json()
    except httpx.HTTPError:
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error=google_failed")
    google_sub = google_user.get("sub")
    email = normalize(google_user.get("email", ""))
    if (
        not google_sub
        or not email
        or google_user.get("aud") != os.getenv("GOOGLE_CLIENT_ID")
        or str(google_user.get("email_verified", "")).lower() != "true"
    ):
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error=google_failed")
    google_nickname = (google_user.get("name") or email.split("@")[0]).strip()[:40] or None
    with db() as connection:
        connection.execute(
            "INSERT INTO pending_google_auth(email, google_sub, nickname, expires_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(email) DO UPDATE SET "
            "google_sub=excluded.google_sub, nickname=excluded.nickname, "
            "expires_at=excluded.expires_at",
            (email, google_sub, google_nickname, int(time.time()) + CODE_TTL * 2),
        )
    try:
        _, email_sent = await issue_code(email, "google", require_email=True)
    except HTTPException as error:
        if error.status_code == 429:
            with db() as connection:
                active_google_code = connection.execute(
                    "SELECT 1 FROM codes WHERE destination=? AND purpose='google' AND expires_at>?",
                    (email, int(time.time())),
                ).fetchone()
            if active_google_code:
                query = httpx.QueryParams({"auth_step": "google_otp", "destination": email})
                return RedirectResponse(f"{FRONTEND_APP_URL}?{query}")
        with db() as connection:
            connection.execute("DELETE FROM pending_google_auth WHERE email=?", (email,))
        logging.warning("Google email OTP could not be issued: %s", error.detail)
        error_code = "google_otp_setup" if error.status_code == 503 else "google_otp_failed"
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error={error_code}")
    if not email_sent:
        with db() as connection:
            connection.execute("DELETE FROM pending_google_auth WHERE email=?", (email,))
        return RedirectResponse(f"{FRONTEND_APP_URL}?auth_error=google_otp_failed")
    query = httpx.QueryParams({"auth_step": "google_otp", "destination": email})
    return RedirectResponse(f"{FRONTEND_APP_URL}?{query}")


# --- Suhbatlar, profil va statistika -----------------------------------------

def conversation_summary(row) -> dict:
    keys = row.keys()
    return {
        "id": int(row["id"]),
        "title": row["title"],
        "created_at": int(row["created_at"] or 0),
        "updated_at": int(row["updated_at"] or 0),
        "total_messages": int(row["total_messages"] or 0) if "total_messages" in keys else 0,
    }


def own_conversation(connection, user_id: int, conversation_id: int):
    row = connection.execute(
        "SELECT * FROM conversations WHERE id=? AND user_id=?", (conversation_id, user_id)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Suhbat topilmadi yoki u sizga tegishli emas.")
    return row


def save_message(connection, conversation_id: int, role: str, content: str, files: list[str] | None = None):
    """Xabarni bazaga yozadi va suhbatning yangilangan vaqtini ko'taradi."""
    stamp = int(time.time())
    connection.execute(
        "INSERT INTO conversation_messages (conversation_id, role, content, files_json, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (conversation_id, role, content, json.dumps(files or [], ensure_ascii=False), stamp),
    )
    connection.execute("UPDATE conversations SET updated_at=? WHERE id=?", (stamp, conversation_id))


# --- Biriktirilgan fayllarni Gemini uchun tayyorlash -------------------------

MAX_ARCHIVE_XML_BYTES = 10 * 1024 * 1024
ZIP_DOC_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/epub+zip",
}
TEXT_FILE_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".html", ".htm",
    ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".rs",
    ".go", ".rb", ".php", ".swift", ".kt", ".sql", ".yml", ".yaml", ".toml", ".ini", ".cfg",
    ".conf", ".log", ".sh", ".bat", ".ps1", ".env", ".gitignore", ".srt", ".vtt",
}
INLINE_MIME_PREFIXES = ("image/", "video/", "audio/", "application/pdf")


def extract_document_text(data: bytes) -> str:
    """DOCX/XLSX/PPTX/ODT/ODS/ODP/EPUB (ZIP asosidagi) fayllardan matn ajratadi."""
    chunks: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml_files = 0
        total_xml_bytes = 0
        for entry in archive.infolist():
            name = entry.filename
            if not name.endswith(".xml") or name.count("/") >= 4:
                continue
            if xml_files >= 40:
                continue
            xml_files += 1
            total_xml_bytes += entry.file_size
            if total_xml_bytes > MAX_ARCHIVE_XML_BYTES:
                raise ValueError("Archive XML content exceeds extraction limits")
            try:
                markup = archive.read(entry).decode("utf-8", "ignore")
            except (KeyError, zipfile.BadZipFile, RuntimeError):
                continue
            text = re.sub(r"<[^>]+>", " ", markup)
            text = html.unescape(re.sub(r"\s+", " ", text)).strip()
            if text:
                chunks.append(f"[{name}] {text}")
    return "\n".join(chunks)


def attachment_parts(name: str, mime_type: str | None, data_base64: str) -> tuple[list[dict], str]:
    """Faylni Gemini `parts` ro'yxatiga aylantiradi (matn, hujjat yoki inline).

    Qaytaradi: (qismlar, ogohlantirish). Ogohlantirish bo'sh bo'lsa fayl to'liq
    qayta ishlandi. Juda katta matn 60 000 belgi bilan cheklanadi.
    """
    try:
        raw = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError):
        return [], f"{name}: fayl o‘qilmadi."
    suffix = Path(name).suffix.lower()
    mime = (mime_type or "").lower()
    if suffix in (".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".epub") or mime in ZIP_DOC_MIME_TYPES:
        try:
            text = extract_document_text(raw)
        except zipfile.BadZipFile:
            return [], f"{name}: hujjat shakli buzuq."
        except (OSError, ValueError):
            return [], f"{name}: hujjatni ochib bo‘lmadi."
        if not text:
            return [], f"{name}: matn topilmadi."
        return [{"text": f"«{name}» faylidan olingan matn:\n{text[:60_000]}"}], ""
    if suffix in TEXT_FILE_EXTENSIONS or mime.startswith("text/"):
        body = raw.decode("utf-8", "ignore")[:60_000]
        if not body.strip():
            return [], f"{name}: fayl bo‘sh."
        return [{"text": f"«{name}» fayli:\n{body}"}], ""
    if suffix == ".zip":
        try:
            text = extract_document_text(raw)
        except (zipfile.BadZipFile, OSError, ValueError):
            return [], f"{name}: arxiv ochilmadi."
        if not text:
            return [], f"{name}: arxiv ichida o‘qiladigan matn yo‘q."
        return [{"text": f"«{name}» arxividan olingan matn:\n{text[:60_000]}"}], ""
    if mime.startswith(INLINE_MIME_PREFIXES):
        return [{"inline_data": {"mime_type": mime_type or "application/octet-stream", "data": data_base64}}], ""
    return [], f"{name}: bu fayl turi matnga aylantirilmadi."


def collect_attachment_parts(payload: "ChatInput") -> tuple[list[dict], list[str], list[str]]:
    """Xabardagi barcha biriktirmalarni qismlarga ajratadi.

    Qaytaradi: (parts, saqlanadigan fayl nomlari, ogohlantirishlar).
    """
    parts: list[dict] = []
    names: list[str] = []
    notes: list[str] = []
    for item in payload.attachments:
        chunk, note = attachment_parts(item.name, item.mime_type, item.data)
        parts.extend(chunk)
        names.append(item.name)
        if note:
            notes.append(note)
    if payload.file_data and payload.file_type:
        legacy_name = payload.attachment_name or "fayl"
        chunk, note = attachment_parts(legacy_name, payload.file_type, payload.file_data)
        parts.extend(chunk)
        names.append(legacy_name)
        if note:
            notes.append(note)
    return parts, names, notes


# --- Suhbatlar, profil va statistika API --------------------------------------

@app.get("/api/conversations")
async def list_conversations(session: str | None = Cookie(default=None)):
    """Foydalanuvchining suhbatlari (eng yangisi birinchi)."""
    user = require_user(session)
    with db() as connection:
        rows = connection.execute(
            "SELECT conversations.*, (SELECT COUNT(*) FROM conversation_messages items "
            "WHERE items.conversation_id = conversations.id) AS total_messages "
            "FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 300",
            (user["id"],),
        ).fetchall()
    return {"conversations": [conversation_summary(row) for row in rows]}


@app.post("/api/conversations")
async def create_conversation(payload: ConversationInput, session: str | None = Cookie(default=None)):
    user = require_user(session)
    stamp = int(time.time())
    with db() as connection:
        new_id = insert_id(
            connection,
            "INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (user["id"], payload.title.strip(), stamp, stamp),
        )
        row = connection.execute("SELECT * FROM conversations WHERE id=?", (new_id,)).fetchone()
    return {"conversation": conversation_summary(row), "message": "Yangi suhbat yaratildi."}


@app.get("/api/conversations/{conversation_id}")
async def conversation_detail(conversation_id: int, session: str | None = Cookie(default=None)):
    """Suhbat tafsiloti va uning barcha xabarlari."""
    user = require_user(session)
    with db() as connection:
        row = own_conversation(connection, user["id"], conversation_id)
        items = connection.execute(
            "SELECT role, content, files_json, created_at FROM conversation_messages "
            "WHERE conversation_id=? ORDER BY id",
            (conversation_id,),
        ).fetchall()
    return {
        "conversation": conversation_summary(row),
        "messages": [
            {
                "role": item["role"],
                "content": item["content"],
                "files": json.loads(item["files_json"] or "[]"),
                "at": int(item["created_at"]),
            }
            for item in items
        ],
    }


@app.patch("/api/conversations/{conversation_id}")
async def rename_conversation(conversation_id: int, payload: ConversationTitleInput, session: str | None = Cookie(default=None)):
    user = require_user(session)
    title = payload.title.strip()
    if not title:
        raise HTTPException(422, "Suhbat nomi bo‘sh bo‘lmasligi kerak.")
    with db() as connection:
        conversation = connection.execute(
            "SELECT user_id FROM conversations WHERE id=?", (conversation_id,)
        ).fetchone()
        if conversation and conversation["user_id"] != user["id"]:
            raise HTTPException(404, "Suhbat topilmadi.")
        if not conversation:
            raise HTTPException(404, "Suhbat topilmadi.")
        connection.execute(
            "UPDATE conversations SET title=?, updated_at=? WHERE id=?",
            (title, int(time.time()), conversation_id),
        )
    return {"message": "Suhbat nomi yangilandi.", "title": title}


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: int, session: str | None = Cookie(default=None)):
    user = require_user(session)
    with db() as connection:
        own_conversation(connection, user["id"], conversation_id)
        connection.execute("DELETE FROM conversation_messages WHERE conversation_id=?", (conversation_id,))
        connection.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
        preferences = connection.execute(
            "SELECT starred_json, drafts_json FROM user_preferences WHERE user_id=?",
            (user["id"],),
        ).fetchone()
        if preferences:
            starred = [item for item in json.loads(preferences["starred_json"]) if item != conversation_id]
            drafts = json.loads(preferences["drafts_json"])
            drafts.pop(str(conversation_id), None)
            connection.execute(
                "UPDATE user_preferences SET starred_json=?, drafts_json=?, updated_at=? WHERE user_id=?",
                (json.dumps(starred), json.dumps(drafts), int(time.time()), user["id"]),
            )
    return {"message": "Suhbat o‘chirildi."}


@app.patch("/api/profile")
async def update_profile(payload: ProfileInput, session: str | None = Cookie(default=None)):
    """Ism (nickname) va avatarni saqlaydi."""
    user = require_user(session)
    nickname = payload.nickname.strip()
    if len(nickname) < 2:
        raise HTTPException(422, "Ism kamida 2 belgidan iborat bo‘lishi kerak.")
    with db() as connection:
        connection.execute(
            "UPDATE users SET nickname=?, avatar=? WHERE id=?",
            (nickname, payload.avatar or None, user["id"]),
        )
        row = connection.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    return {"user": public_user(row), "message": "Profil saqlandi."}


@app.get("/api/preferences")
async def get_preferences(session: str | None = Cookie(default=None)):
    user = require_user(session)
    with db() as connection:
        row = connection.execute(
            "SELECT settings_json, starred_json, drafts_json FROM user_preferences WHERE user_id=?",
            (user["id"],),
        ).fetchone()
    return {
        "settings": json.loads(row["settings_json"]) if row else {},
        "starred_conversations": json.loads(row["starred_json"]) if row else [],
        "drafts": json.loads(row["drafts_json"]) if row else {},
    }


@app.patch("/api/preferences")
async def update_preferences(
    payload: UserPreferencesInput,
    session: str | None = Cookie(default=None),
):
    user = require_user(session)
    with db() as connection:
        existing = connection.execute(
            "SELECT settings_json, starred_json, drafts_json FROM user_preferences WHERE user_id=?",
            (user["id"],),
        ).fetchone()
        settings = json.loads(existing["settings_json"]) if existing else {}
        starred = json.loads(existing["starred_json"]) if existing else []
        drafts = json.loads(existing["drafts_json"]) if existing else {}

        if payload.settings is not None:
            setting_types = {
                "theme": {"dark", "light"},
                "compact": bool,
                "sound": bool,
                "enterToSend": bool,
                "font": {"standart", "katta", "kattaroq"},
                "systemTheme": bool,
                "readAloud": bool,
            }
            for key, value in payload.settings.items():
                if key not in setting_types:
                    raise HTTPException(422, f"Noma’lum sozlama: {key}.")
                expected = setting_types[key]
                if (
                    isinstance(expected, set) and value not in expected
                    or expected is bool and type(value) is not bool
                ):
                    raise HTTPException(422, f"Sozlama qiymati yaroqsiz: {key}.")
                settings[key] = value

        if payload.starred_conversations is not None:
            requested_starred = list(dict.fromkeys(payload.starred_conversations))
            starred = []
            for conversation_id in requested_starred:
                conversation = connection.execute(
                    "SELECT user_id FROM conversations WHERE id=?", (conversation_id,)
                ).fetchone()
                if conversation and conversation["user_id"] != user["id"]:
                    raise HTTPException(404, "Suhbat topilmadi.")
                if conversation:
                    starred.append(conversation_id)

        if payload.drafts is not None:
            if len(payload.drafts) > 301 or sum(map(len, payload.drafts.values())) > 50_000:
                raise HTTPException(422, "Qoralama hajmi saqlash chegarasidan oshdi.")
            requested_drafts = dict(payload.drafts)
            for key, value in list(requested_drafts.items()):
                if key != "new":
                    try:
                        conversation_id = int(key)
                    except ValueError as error:
                        raise HTTPException(422, "Qoralama suhbat identifikatori yaroqsiz.") from error
                    conversation = connection.execute(
                        "SELECT user_id FROM conversations WHERE id=?", (conversation_id,)
                    ).fetchone()
                    if conversation and conversation["user_id"] != user["id"]:
                        raise HTTPException(404, "Suhbat topilmadi.")
                    if not conversation:
                        requested_drafts.pop(key)
                        continue
                if len(value) > 20_000:
                    raise HTTPException(422, "Bitta qoralama 20 000 belgidan oshmasligi kerak.")
            drafts = requested_drafts

        connection.execute(
            "INSERT INTO user_preferences(user_id, settings_json, starred_json, drafts_json, updated_at) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET "
            "settings_json=excluded.settings_json, starred_json=excluded.starred_json, "
            "drafts_json=excluded.drafts_json, updated_at=excluded.updated_at",
            (
                user["id"],
                json.dumps(settings),
                json.dumps(starred),
                json.dumps(drafts),
                int(time.time()),
            ),
        )
    return {
        "settings": settings,
        "starred_conversations": starred,
        "drafts": drafts,
        "message": "Sozlamalar saqlandi.",
    }


@app.get("/api/stats")
async def statistics(session: str | None = Cookie(default=None)):
    """Statistika oynasi uchun raqamlar."""
    user = require_user(session)
    with db() as connection:
        conversations = connection.execute(
            "SELECT COUNT(*) AS total FROM conversations WHERE user_id=?", (user["id"],)
        ).fetchone()["total"]
        messages = connection.execute(
            "SELECT COUNT(*) AS total FROM conversation_messages items "
            "JOIN conversations ON conversations.id = items.conversation_id WHERE conversations.user_id=?",
            (user["id"],),
        ).fetchone()["total"]
        answers = connection.execute(
            "SELECT COUNT(*) AS total FROM conversation_messages items "
            "JOIN conversations ON conversations.id = items.conversation_id "
            "WHERE conversations.user_id=? AND items.role='assistant'",
            (user["id"],),
        ).fetchone()["total"]
        recent = connection.execute(
            "SELECT day, messages FROM usage WHERE user_id=? ORDER BY day DESC LIMIT 7", (user["id"],)
        ).fetchall()
    return {
        "conversations": int(conversations),
        "messages": int(messages),
        "answers": int(answers),
        "used_today": usage_today(user["id"]),
        "daily_limit": DAILY_MESSAGE_LIMIT,
        "verified": bool(user["verified"]),
        "member_since": int(user["created_at"] or 0),
        "recent_days": [{"day": row["day"], "messages": int(row["messages"])} for row in reversed(recent)],
    }


# --- Gemini model tanlash -----------------------------------------------------
# Google model nomlarini tez-tez almashtiradi (masalan gemini-1.5-flash endi
# mavjud emas). Shuning uchun avval .env dagi model, bo'lmasa kalit qo'llaydigan
# boshqa modellar sinaladi - sayt "model topilmadi" xatosi bilan to'xtamaydi.

GEMINI_API_VERSION = os.getenv("GEMINI_API_VERSION", "v1beta")
PREFERRED_MODELS = (
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.8-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-pro-latest",
)
MODEL_CACHE_SECONDS = 900


class ModelProbe(TypedDict):
    name: str
    checked: float
    candidates: list[str]


_model_probe: ModelProbe = {"name": "", "checked": 0.0, "candidates": []}


def configured_model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip() or "gemini-flash-latest"


async def live_models(client: httpx.AsyncClient, key: str) -> list[str]:
    """Kalit uchun generateContent ni qo'llaydigan model nomlari (bilinmasa - bo'sh ro'yxat)."""
    try:
        response = await client.get(
            f"https://generativelanguage.googleapis.com/{GEMINI_API_VERSION}/models",
            headers={"x-goog-api-key": key},
            params={"pageSize": 200},
        )
    except httpx.HTTPError:
        return []
    if response.status_code != 200:
        return []
    try:
        payload = response.json()
    except ValueError:
        logging.warning("Gemini model discovery returned invalid JSON.")
        return []
    if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
        logging.warning("Gemini model discovery returned an unexpected response.")
        return []
    return [
        str(item.get("name", "")).split("/")[-1]
        for item in payload["models"]
        if isinstance(item, dict)
        and "generateContent" in (item.get("supportedGenerationMethods") or [])
    ]


def model_queue(live: list[str]) -> list[str]:
    """Tartib: .env dagi model -> ishonchli zaxiralar -> kalitdagi boshqa matn modellari."""
    queue: list[str] = []
    for name in (configured_model(), *PREFERRED_MODELS):
        if name and name not in queue:
            queue.append(name)
    if live:
        queue = [name for name in queue if name in live]
        queue.extend(
            name
            for name in live
            if name not in queue and not any(skip in name for skip in ("preview", "-tts", "image", "embedding"))
        )
    return queue[:6] or [configured_model()]


async def model_queue_for(client: httpx.AsyncClient, key: str) -> list[str]:
    """Ishlagan model 15 daqiqa eslab qolinadi, aks holda ro'yxat qayta aniqlanadi."""
    cached = str(_model_probe.get("name") or "")
    if cached and time.time() - float(_model_probe.get("checked") or 0.0) < MODEL_CACHE_SECONDS:
        candidates = _model_probe["candidates"]
        return [cached, *(name for name in candidates if name != cached)][:6]
    live = await live_models(client, key)
    queue = model_queue(live)
    _model_probe["candidates"] = queue
    return queue


def model_is_missing(status: int, detail: str) -> bool:
    """Eskirgan model nomi uchun Google shunday javob qaytaradi."""
    lowered = detail.lower()
    return status in (400, 403, 404) and any(
        marker in lowered
        for marker in (
            "not found",
            "not supported",
            "does not exist",
            "unsupported",
            "is not found for api version",
            "no longer available",
            "has been deprecated",
        )
    )


def model_is_busy(status: int, detail: str) -> bool:
    """Model vaqtincha band yoki yuklama yuqori - keyingi modelni sinash mantiqan to'g'ri."""
    lowered = detail.lower()
    return status in (500, 502, 503, 504, 529) or "high demand" in lowered or "overloaded" in lowered


def gemini_error(status: int, detail: str) -> HTTPException:
    """Gemini javobini foydalanuvchi tushunadigan xabarga aylantiradi."""
    if status == 400 and "API key not valid" in detail:
        return HTTPException(
            503,
            "Serverdagi Gemini API kaliti yaroqsiz. Administrator AI Studio'dan yangi kalit olib .env ga yozishi kerak.",
        )
    if status == 429:
        return HTTPException(429, "Gemini bepul limiti tugadi. Bir daqiqadan so'ng qayta urinib ko'ring.")
    if model_is_missing(status, detail):
        return HTTPException(
            503,
            f"«{configured_model()}» modeli Google tomonidan yopilgan. .env faylida "
            "GEMINI_MODEL=gemini-flash-latest qilib yozib, serverni qayta ishga tushiring.",
        )
    if model_is_busy(status, detail):
        return HTTPException(
            503,
            "AI modellari hozir band (Google yuklamasi yuqori). 10-20 soniyadan so'ng savolni qayta yuboring.",
        )
    return HTTPException(status, detail or "Gemini xatosi.")


@app.get("/api/model")
async def model_info():
    """Diagnostika: qaysi model ishlatilayotgani va zaxirada nimalar borligi."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(503, "Serverda GEMINI_API_KEY sozlanmagan.")
    async with httpx.AsyncClient(timeout=30) as client:
        live = await live_models(client, key)
    return {
        "configured": configured_model(),
        "in_use": str(_model_probe.get("name") or ""),
        "queue": model_queue(live),
        "available_count": len(live),
        "available": live[:25],
    }


# --- Chat --------------------------------------------------------------------

CHAT_REQUEST_TIMEOUT_SECONDS = 45


@app.post("/api/chat")
async def chat(payload: ChatInput, session: str | None = Cookie(default=None)):
    user = session_user(session)
    if not user:
        raise HTTPException(401, "Chatdan foydalanish uchun tizimga kiring.")
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(503, "Serverda GEMINI_API_KEY sozlanmagan. Administrator .env faylini to‘ldirishi kerak.")
    if DAILY_MESSAGE_LIMIT and usage_today(user["id"]) >= DAILY_MESSAGE_LIMIT:
        raise HTTPException(429, f"Kunlik limit ({DAILY_MESSAGE_LIMIT} xabar) tugadi. Ertaga yana urinib ko‘ring.")
    if payload.conversation_id:
        with db() as connection:
            own_conversation(connection, user["id"], payload.conversation_id)
    parts = [{"text": payload.prompt}]
    file_parts, file_names, notes = collect_attachment_parts(payload)
    parts.extend(file_parts)
    data: dict = {}
    try:
        async with asyncio.timeout(CHAT_REQUEST_TIMEOUT_SECONDS):
            async with httpx.AsyncClient(timeout=CHAT_REQUEST_TIMEOUT_SECONDS) as client:
                queue = await model_queue_for(client, key)
                for index, model in enumerate(queue):
                    try:
                        response = await client.post(
                            f"https://generativelanguage.googleapis.com/{GEMINI_API_VERSION}/models/{model}:generateContent",
                            headers={"x-goog-api-key": key},
                            json={"contents": [{"parts": parts}]},
                            timeout=httpx.Timeout(25, connect=10),
                        )
                    except httpx.TimeoutException as error:
                        logging.warning("Gemini model %s timed out; trying the next available model.", model)
                        if index < len(queue) - 1:
                            continue
                        raise HTTPException(
                            504,
                            "Gemini modellari javob berishga kechikdi. Bir ozdan so‘ng qayta urinib ko‘ring.",
                        ) from error
                    try:
                        data = response.json() if response.content else {}
                    except ValueError as error:
                        logging.error(
                            "Gemini API returned invalid JSON (HTTP %s).",
                            response.status_code,
                        )
                        raise HTTPException(
                            502,
                            "Gemini xizmati noto‘g‘ri javob qaytardi. Birozdan so‘ng qayta urinib ko‘ring.",
                        ) from error
                    if not isinstance(data, dict):
                        logging.error(
                            "Gemini API returned an unexpected JSON response (HTTP %s).",
                            response.status_code,
                        )
                        raise HTTPException(
                            502,
                            "Gemini xizmati kutilmagan javob qaytardi. Birozdan so‘ng qayta urinib ko‘ring.",
                        )
                    error_data = data.get("error")
                    detail = str(error_data.get("message", "")) if isinstance(error_data, dict) else ""
                    if response.status_code < 400:
                        _model_probe.update({"name": model, "checked": time.time()})
                        break
                    retryable = model_is_missing(response.status_code, detail) or model_is_busy(
                        response.status_code, detail
                    )
                    if retryable and index < len(queue) - 1:
                        logging.warning(
                            "Gemini model %s returned %s; trying the next available model.",
                            model,
                            response.status_code,
                        )
                        continue
                    raise gemini_error(response.status_code, detail)
    except HTTPException:
        raise
    except TimeoutError as error:
        logging.warning("Gemini chat request exceeded the %s-second response deadline.", CHAT_REQUEST_TIMEOUT_SECONDS)
        raise HTTPException(
            504,
            "AI javobi juda uzoq kutildi. Savolingiz maydonda qoladi — birozdan so‘ng qayta yuboring.",
        ) from error
    except httpx.HTTPError as error:
        logging.error("Gemini API transport failure: %s", type(error).__name__)
        raise HTTPException(
            503,
            "Google Gemini API bilan ulanish uzildi. Internet yoki Google API xizmati tiklangach qayta urinib ko‘ring.",
        ) from error
    candidates = data.get("candidates")
    if candidates is not None and not isinstance(candidates, list):
        raise HTTPException(502, "Gemini xizmati kutilmagan javob qaytardi.")
    candidates = candidates or []
    if not candidates:
        feedback = data.get("promptFeedback")
        blocked = isinstance(feedback, dict) and bool(feedback.get("blockReason"))
        raise HTTPException(
            400,
            "Javob berilmadi: savol xavfsizlik filtridan o‘tmadi."
            if blocked
            else "Gemini javob qaytarmadi. Savolni boshqacha yozib ko‘ring.",
        )
    candidate = candidates[0]
    content = candidate.get("content") if isinstance(candidate, dict) else None
    response_parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(response_parts, list):
        raise HTTPException(502, "Gemini xizmati kutilmagan javob qaytardi.")
    text = "".join(
        part.get("text", "")
        for part in response_parts
        if isinstance(part, dict) and isinstance(part.get("text", ""), str)
    )
    answer = text.strip() or "Javob olinmadi."
    stamp = int(time.time())
    with db() as connection:
        conversation_id = payload.conversation_id
        if conversation_id is None:
            first_line = next((line.strip() for line in payload.prompt.splitlines() if line.strip()), "")
            created_conversation_id = insert_id(
                connection,
                "INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (user["id"], first_line[:72] or "Yangi suhbat", stamp, stamp),
            )
            if created_conversation_id is None:
                raise HTTPException(500, "Suhbat yaratilmadi. Qayta urinib ko‘ring.")
            conversation_id = created_conversation_id
        save_message(connection, conversation_id, "user", payload.prompt, file_names)
        save_message(connection, conversation_id, "assistant", answer)
    add_usage(user["id"])
    return {
        "text": answer,
        "conversation_id": conversation_id,
        "used_today": usage_today(user["id"]),
        "daily_limit": DAILY_MESSAGE_LIMIT,
        "notes": notes,
    }


@app.get("/{frontend_path:path}", include_in_schema=False)
async def frontend_route(frontend_path: str):
    if frontend_path == "api" or frontend_path.startswith("api/"):
        raise HTTPException(404, "API endpoint topilmadi.")
    if frontend_path == "app" or frontend_path.startswith("app/"):
        return FileResponse(frontend_page())
    raise HTTPException(404, "Sahifa topilmadi.")
