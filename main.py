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
import mimetypes
import os
import re
import secrets
import smtplib
import sqlite3
import time
import zipfile
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

load_dotenv()

ROOT = Path(__file__).parent
DB = Path(os.getenv("NAVO_DB_PATH", ROOT / "app.db"))
SESSION_DAYS = 30
CODE_TTL = 600
CODE_RESEND_SECONDS = 45
MAX_CODE_ATTEMPTS = 5
DAILY_MESSAGE_LIMIT = int(os.getenv("DAILY_MESSAGE_LIMIT", "30"))
APP_ORIGIN = os.getenv("APP_ORIGIN", "http://127.0.0.1:8000")

password_hash = PasswordHash.recommended()
app = FastAPI(title="Gemini Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[APP_ORIGIN],
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/css", StaticFiles(directory=ROOT / "css"), name="css")
app.mount("/js", StaticFiles(directory=ROOT / "js"), name="js")
if (ROOT / "dist" / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=ROOT / "dist" / "assets"), name="assets")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def db():
    connection = sqlite3.connect(DB, timeout=15)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_column(connection, table: str, column: str, definition: str):
    existing = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db():
    with db() as connection:
        connection.executescript(
            """
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
            CREATE INDEX IF NOT EXISTS conversation_messages_order
                ON conversation_messages(conversation_id, id);
            """
        )
        ensure_column(connection, "users", "created_at", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(connection, "users", "nickname", "TEXT")
        ensure_column(connection, "users", "avatar", "TEXT")
        ensure_column(connection, "codes", "attempts", "INTEGER NOT NULL DEFAULT 0")


init_db()


class RegisterInput(BaseModel):
    email: str | None = None
    phone: str | None = None
    password: str = Field(min_length=8, max_length=128)
    nickname: str | None = Field(default=None, min_length=2, max_length=40)


class ProfileInput(BaseModel):
    nickname: str = Field(min_length=2, max_length=40)
    avatar: str | None = Field(default=None, max_length=700_000)


class LoginInput(BaseModel):
    identity: str
    password: str


class ForgotInput(BaseModel):
    destination: str


class CodeInput(BaseModel):
    destination: str
    code: str = Field(min_length=4, max_length=8)
    purpose: str = "register"


class ResetInput(BaseModel):
    destination: str
    code: str = Field(min_length=4, max_length=8)
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
    if (os.getenv("DEV_SHOW_OTP", "false") or "").strip().lower() in {"1", "true", "yes", "on"}:
        return "demo"
    if destination.startswith("+"):
        ready = bool(os.getenv("ESKIZ_EMAIL") and os.getenv("ESKIZ_PASSWORD"))
        return "sms" if ready else "demo"
    ready = all(os.getenv(name) for name in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"))
    return "email" if ready else "demo"


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
        "verified": bool(data.get("verified")),
        "created_at": int(data.get("created_at") or 0),
    }


def session_user(token: str | None):
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db() as connection:
        row = connection.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id "
            "WHERE sessions.token_hash=? AND sessions.expires_at>?",
            (token_hash, int(time.time())),
        ).fetchone()
    return row


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with db() as connection:
        connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + 60 * 60 * 24 * SESSION_DAYS),
        )
    return token


def start_session(response: Response, user_id: int):
    response.set_cookie("session", create_session(user_id), httponly=True, samesite="lax", max_age=60 * 60 * 24 * SESSION_DAYS)


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
        token = token_response.json()["data"]["token"]
        response = await client.post(
            "https://notify.eskiz.uz/api/message/sms/send",
            headers={"Authorization": f"Bearer {token}"},
            data={"mobile_phone": phone.replace("+", ""), "message": f"Tasdiqlash kodi: {code}", "from": "4546"},
        )
        if response.status_code >= 400:
            detail = response.json().get("message", "SMS yuborilmadi.")
            raise HTTPException(502, f"SMS yuborilmadi: {detail}")


def send_email(address: str, code: str):
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    if not host or not user or not password:
        raise HTTPException(503, "Email xizmati sozlanmagan. .env faylida SMTP sozlamalarini kiriting.")
    message = EmailMessage()
    message["Subject"] = "Gemini Chat tasdiqlash kodi"
    message["From"] = user
    message["To"] = address
    message.set_content(f"Sizning tasdiqlash kodingiz: {code}\nKod 10 daqiqa amal qiladi.")
    try:
        with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=20) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise HTTPException(502, "Tasdiqlash emailini yuborib bo‘lmadi. SMTP sozlamalarini tekshiring.") from error


def drop_code(destination: str):
    with db() as connection:
        connection.execute("DELETE FROM codes WHERE destination=?", (destination,))


async def issue_code(destination: str, purpose: str) -> str:
    """Kod yaratadi va mavjud bo'lsa real kanal orqali yuboradi.

    Eskiz yoki Gmail sozlanmagan bo'lsa kod demo rejimida qaytariladi, shunda
    sayt hech qanday tashqi xizmatsiz ham ishlayveradi (OTP_MODE=live bilan
    o'chirib qo'yish mumkin).
    """
    destination = normalize(destination)
    channel = channel_for(destination)
    connection = db()
    try:
        connection.execute("DELETE FROM codes WHERE expires_at < ?", (int(time.time()),))
        row = connection.execute("SELECT expires_at FROM codes WHERE destination=?", (destination,)).fetchone()
        if row and row["expires_at"] > time.time() + CODE_TTL - CODE_RESEND_SECONDS:
            raise HTTPException(429, "Kod yaqinda yuborilgan. Bir daqiqadan so‘ng qayta urinib ko‘ring.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        connection.execute(
            "INSERT OR REPLACE INTO codes (destination, code_hash, expires_at, purpose, attempts) "
            "VALUES (?, ?, ?, ?, 0)",
            (destination, hashlib.sha256(code.encode()).hexdigest(), int(time.time()) + CODE_TTL, purpose),
        )
        connection.commit()
    finally:
        connection.close()
    if channel == "sms":
        await send_sms(destination, code)
    elif channel == "email":
        await asyncio.to_thread(send_email, destination, code)
    elif otp_mode() == "live":
        drop_code(destination)
        raise HTTPException(503, "Tasdiqlash kodi yuboriladigan xizmat sozlanmagan. Administrator .env faylini to‘ldirishi kerak.")
    return code


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
    return bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))


# --- Sahifalar va sozlamalar -------------------------------------------------

@app.get("/")
async def index():
    return FileResponse(ROOT / "index.html")


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(ROOT / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(ROOT / "sw.js", media_type="application/javascript")


@app.get("/api/config")
async def config():
    """Frontend qaysi kirish usullari yoqilganini shu yerdan biladi."""
    sms_ready = bool(os.getenv("ESKIZ_EMAIL") and os.getenv("ESKIZ_PASSWORD"))
    email_ready = all(os.getenv(name) for name in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"))
    return {
        "google_login": google_ready(),
        "sms_channel": "sms" if sms_ready else "demo",
        "email_channel": "email" if email_ready else "demo",
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
async def logout(response: Response, session: str | None = Cookie(default=None)):
    if session:
        with db() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(session.encode()).hexdigest(),)
            )
    response.delete_cookie("session")
    return {"message": "Siz hisobdan chiqdingiz."}


# --- Ro'yxatdan o'tish va kirish --------------------------------------------

@app.post("/api/auth/register")
async def register(payload: RegisterInput):
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
    existing = find_user(destination)
    if existing and existing["verified"]:
        raise HTTPException(409, "Bu hisob allaqachon mavjud. «Kirish» bo‘limidan foydalaning.")
    with db() as connection:
        if existing:
            connection.execute(
                "UPDATE users SET password_hash=? WHERE id=?", (password_hash.hash(payload.password), existing["id"])
            )
        else:
            connection.execute(
                "INSERT INTO users(email, phone, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (
                    destination if is_email else None,
                    None if is_email else destination,
                    password_hash.hash(payload.password),
                    int(time.time()),
                ),
            )
    code = await issue_code(destination, "register")
    channel = channel_for(destination)
    message = (
        f"Tasdiqlash kodi {channel_label(channel)} yuborildi."
        if channel != "demo"
        else "Tasdiqlash kodi yaratildi. Quyidagi kodni kiriting."
    )
    return {
        "message": message,
        "destination": destination,
        "channel": channel,
        "demo_code": code if channel == "demo" else None,
    }


@app.post("/api/auth/verify")
async def verify_code(payload: CodeInput, response: Response):
    destination = normalize(payload.destination)
    identity_kind(destination)
    rate_limit(f"verify:{destination}", 20, 900)
    check_code(destination, payload.code, payload.purpose)
    user = find_user(destination)
    if not user:
        raise HTTPException(404, "Bu manzil uchun hisob topilmadi. Qayta ro‘yxatdan o‘ting.")
    with db() as connection:
        connection.execute("UPDATE users SET verified=1 WHERE id=?", (user["id"],))
    start_session(response, user["id"])
    message = "Hisob tasdiqlandi." if payload.purpose == "register" else "Kod tasdiqlandi."
    return {"message": message, "user": public_user(user)}


@app.post("/api/auth/login")
async def login(payload: LoginInput, response: Response):
    identity = normalize(payload.identity)
    if not identity:
        raise HTTPException(400, "Email yoki telefon raqamini kiriting.")
    rate_limit(
        f"login:{identity}", 10, 900, "Login urinishlari ko‘payib ketdi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
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
    start_session(response, user["id"])
    return {
        "message": "Kirish muvaffaqiyatli.",
        "user": public_user(user),
        "used_today": usage_today(user["id"]),
        "daily_limit": DAILY_MESSAGE_LIMIT,
    }


# --- Parolni tiklash ---------------------------------------------------------

@app.post("/api/auth/forgot")
async def forgot(payload: ForgotInput):
    destination = normalize(payload.destination)
    identity_kind(destination)
    if not find_user(destination):
        raise HTTPException(404, "Bunday hisob topilmadi. Avval ro‘yxatdan o‘ting.")
    rate_limit(
        f"forgot:{destination}", 5, 900, "Kod juda ko‘p marta so‘raldi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    code = await issue_code(destination, "reset")
    channel = channel_for(destination)
    return {
        "message": f"Parolni tiklash kodi {channel_label(channel)} yuborildi."
        if channel != "demo"
        else "Tiklash kodi yaratildi. Quyidagi kodni kiriting.",
        "destination": destination,
        "channel": channel,
        "demo_code": code if channel == "demo" else None,
    }


@app.post("/api/auth/resend")
async def resend(payload: ResendInput):
    destination = normalize(payload.destination)
    identity_kind(destination)
    purpose = payload.purpose if payload.purpose in {"register", "reset"} else "register"
    user = find_user(destination)
    if not user:
        raise HTTPException(404, "Bunday hisob topilmadi. Avval ro‘yxatdan o‘ting.")
    if purpose == "reset" and not user["verified"]:
        raise HTTPException(403, "Avval hisobni tasdiqlang, keyin parolni tiklang.")
    rate_limit(
        f"resend:{destination}", 5, 900, "Kod juda ko‘p marta so‘raldi. 15 daqiqadan so‘ng qayta urinib ko‘ring."
    )
    code = await issue_code(destination, purpose)
    channel = channel_for(destination)
    return {
        "message": f"Yangi kod {channel_label(channel)} yuborildi."
        if channel != "demo"
        else "Yangi kod yaratildi. Quyidagi kodni kiriting.",
        "destination": destination,
        "channel": channel,
        "demo_code": code if channel == "demo" else None,
    }


@app.post("/api/auth/reset")
async def reset(payload: ResetInput):
    destination = normalize(payload.destination)
    identity_kind(destination)
    rate_limit(f"reset:{destination}", 10, 900)
    user = find_user(destination)
    if not user:
        raise HTTPException(404, "Bunday hisob topilmadi.")
    check_code(destination, payload.code, "reset")
    with db() as connection:
        connection.execute(
            "UPDATE users SET password_hash=?, verified=1 WHERE id=?",
            (password_hash.hash(payload.password), user["id"]),
        )
        connection.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    return {"message": "Parol yangilandi. Endi yangi parol bilan kiring."}


# --- Google orqali kirish ----------------------------------------------------

@app.get("/api/auth/google")
async def google_start():
    if not google_ready():
        return RedirectResponse("/?auth_error=google_config")
    state = secrets.token_urlsafe(24)
    with db() as connection:
        connection.execute("INSERT INTO oauth_states VALUES (?, ?)", (state, int(time.time()) + 600))
    query = httpx.QueryParams(
        {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "redirect_uri": f"{APP_ORIGIN}/api/auth/google/callback",
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "select_account",
            "state": state,
        }
    )
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{query}")


@app.get("/api/auth/google/callback")
async def google_callback(code: str = "", state: str = ""):
    if not google_ready():
        return RedirectResponse("/?auth_error=google_config")
    with db() as connection:
        valid = connection.execute(
            "SELECT state FROM oauth_states WHERE state=? AND expires_at>?", (state, int(time.time()))
        ).fetchone()
        connection.execute("DELETE FROM oauth_states WHERE state=?", (state,))
    if not valid or not code:
        return RedirectResponse("/?auth_error=google_state")
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "redirect_uri": f"{APP_ORIGIN}/api/auth/google/callback",
                    "grant_type": "authorization_code",
                },
            )
            token_response.raise_for_status()
            id_token = token_response.json().get("id_token")
            profile = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": id_token})
            profile.raise_for_status()
            google_user = profile.json()
    except httpx.HTTPError:
        return RedirectResponse("/?auth_error=google_failed")
    google_sub = google_user.get("sub")
    email = normalize(google_user.get("email", ""))
    if not google_sub or not email:
        return RedirectResponse("/?auth_error=google_failed")
    with db() as connection:
        existing = connection.execute(
            "SELECT * FROM users WHERE google_sub=? OR email=?", (google_sub, email)
        ).fetchone()
        if existing:
            connection.execute("UPDATE users SET google_sub=?, verified=1 WHERE id=?", (google_sub, existing["id"]))
            user_id = existing["id"]
        else:
            user_id = connection.execute(
                "INSERT INTO users(email, google_sub, verified, created_at) VALUES (?, ?, 1, ?)",
                (email, google_sub, int(time.time())),
            ).lastrowid
    response = RedirectResponse("/")
    start_session(response, user_id)
    return response


# --- Chat --------------------------------------------------------------------

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
    parts = [{"text": payload.prompt}]
    if payload.file_data and payload.file_type:
        parts.append({"inline_data": {"mime_type": payload.file_type, "data": payload.file_data}})
    model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": key},
                json={"contents": [{"parts": parts}]},
            )
    except httpx.HTTPError as error:
        raise HTTPException(504, "Gemini serveriga ulanib bo‘lmadi. Internetni tekshirib qayta urinib ko‘ring.") from error
    data = response.json() if response.content else {}
    detail = str(data.get("error", {}).get("message", ""))
    if response.status_code == 400 and "API key not valid" in detail:
        raise HTTPException(
            503,
            "Serverdagi Gemini API kaliti yaroqsiz. Administrator AI Studio'dan yangi kalit olib .env ga yozishi kerak.",
        )
    if response.status_code == 429:
        raise HTTPException(429, "Gemini bepul limiti tugadi. Bir daqiqadan so‘ng qayta urinib ko‘ring.")
    if response.status_code >= 400:
        raise HTTPException(response.status_code, detail or "Gemini xatosi.")
    candidates = data.get("candidates") or []
    if not candidates:
        blocked = bool(data.get("promptFeedback", {}).get("blockReason"))
        raise HTTPException(
            400,
            "Javob berilmadi: savol xavfsizlik filtridan o‘tmadi."
            if blocked
            else "Gemini javob qaytarmadi. Savolni boshqacha yozib ko‘ring.",
        )
    text = "".join(part.get("text", "") for part in candidates[0].get("content", {}).get("parts", []))
    add_usage(user["id"])
    return {
        "text": text.strip() or "Javob olinmadi.",
        "used_today": usage_today(user["id"]),
        "daily_limit": DAILY_MESSAGE_LIMIT,
    }
