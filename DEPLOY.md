# 🚀 Navo AI — Production Deploy Bo'yicha To'liq Qo'llanma

Ushbu qo'llanmada **Navo AI** ilovasini production muhitida (VPS, Docker, Railway, Fly.io) xavfsiz va to'g'ri ishga tushirish bo'yicha to'liq qadamlar keltirilgan.

---

## 📋 Mundarija
1. [Arxitektura va umumiy ma'lumot](#1-arxitektura-va-umumiy-malumot)
2. [Muhit o'zgaruvchilari (.env jadvali)](#2-muhit-ozgaruvchilari-env-jadvali)
3. [Variant A: Docker va Docker Compose orqali deploy (Tavsiya etiladi)](#3-variant-a-docker-va-docker-compose-orqali-deploy)
4. [Variant B: Ubuntu VPS (Nginx + Systemd + Certbot SSL) orqali deploy](#4-variant-b-ubuntu-vps-nginx--systemd--certbot-ssl)
5. [Yangilash tartibi (Update Guide)](#5-yangilash-tartibi-update-guide)
6. [Monitoring, Loglarni ko'rish va Healthcheck](#6-monitoring-loglarni-korish-va-healthcheck)
7. [Qo'lda bajarilishi kerak bo'lgan ishlar ro'yxati](#7-qolda-bajarilishi-kerak-bolgan-ishlar-royxati)

---

## 1. Arxitektura va umumiy ma'lumot

Navo AI serveri yagona port va domen ostida ishlaydi:
- **FastAPI backend (`backend/main.py`)**: API (`/api/*`), suhbatlar, Google OAuth va autentifikatsiyani boshqaradi.
- **Frontend SPA (`frontend/dist/`)**: Vite + React ilovasi build qilinib, FastAPI orqali statik uzatiladi (`/app/` va `/assets/*`).
- **Showcase (Landing page)**: `frontend/showcase/` orqali `/` bosh sahifasida beriladi.
- **Yagona port va domen**: Frontend va backend bitta domen va bitta portda (`https://yourdomain.com`) ishlagani sababli CORS va cookie (`SameSite/Secure/HttpOnly`) muammolari kelib chiqmaydi.

---

## 2. Muhit o'zgaruvchilari (.env jadvali)

Haqiqiy serverda `.env` faylini yarating va quyidagi o'zgaruvchilarni to'ldiring:

| O'zgaruvchi | Tavsif | Namuna qiymat | Majburiyligi |
| :--- | :--- | :--- | :--- |
| `ENVIRONMENT` | Muhit turi (`production` yoki `development`) | `production` | **Majburiy** |
| `HOST` | Server tinglaydigan tarmoq manzili | `0.0.0.0` | **Majburiy** |
| `PORT` | Server porti | `5507` | **Majburiy** |
| `APP_ORIGIN` | Asosiy domen manzili (protokol bilan, oxirida `/` bo'lmasin) | `https://yourdomain.com` | **Majburiy** |
| `FRONTEND_ORIGIN` | Frontend domen manzili | `https://yourdomain.com` | **Majburiy** |
| `CORS_ALLOWED_ORIGINS`| CORS ruxsat etilgan domenlar (vergul bilan) | `https://yourdomain.com` | **Majburiy** |
| `SESSION_SECRET` | Sessiya va JWT shifrlash kaliti (kamida 32 ta belgi) | *Tasodifiy 64 belgili satr* | **Majburiy (Production'da)** |
| `FORWARDED_ALLOW_IPS` | Reverse proxy IP manzillari | `*` yoki `127.0.0.1` | **Majburiy (Nginx ortida)** |
| `GEMINI_API_KEY` | Google Gemini AI kaliti | `AIzaSy...` | **Majburiy** |
| `GEMINI_MODEL` | Gemini modeli | `gemini-flash-latest` | Tavsiya etiladi |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `...apps.googleusercontent.com` | Google auth uchun |
| `GOOGLE_CLIENT_SECRET`| Google OAuth Client Secret | `GOCSPX-...` | Google auth uchun |
| `GOOGLE_REDIRECT_URI` | Google OAuth qaytish manzili | `https://yourdomain.com/api/auth/google/callback` | Google auth uchun |
| `EMAIL_PROVIDER` | Email provayderi (`smtp`, `resend`, `brevo`) | `smtp` | **Majburiy** |
| `SMTP_HOST` | SMTP server manzili | `smtp.gmail.com` | SMTP uchun |
| `SMTP_PORT` | SMTP porti (465 = SSL, 587 = STARTTLS) | `465` | SMTP uchun |
| `SMTP_USER` | SMTP login / email | `aloqa@yourdomain.com` | SMTP uchun |
| `SMTP_PASSWORD` | SMTP paroli (Gmail uchun ilova paroli) | `xxxx yyyy zzzz wwww` | SMTP uchun |
| `RESEND_API_KEY` | Resend API kaliti (agar provayder `resend` bo'lsa) | `re_123456...` | Resend uchun |
| `RESEND_SENDER_EMAIL` | Resend jo'natuvchi emaili | `Navo AI <onboarding@resend.dev>` | Resend uchun |
| `BREVO_API_KEY` | Brevo API kaliti (agar provayder `brevo` bo'lsa) | `xkeysib-...` | Brevo uchun |
| `BREVO_SENDER_EMAIL` | Brevo tasdiqlangan jo'natuvchi emaili | `aloqa@yourdomain.com` | Brevo uchun |
| `ESKIZ_EMAIL` | Eskiz.uz login (SMS uchun) | `admin@yourdomain.com` | SMS uchun |
| `ESKIZ_PASSWORD` | Eskiz.uz paroli (SMS uchun) | `parol` | SMS uchun |
| `DEV_SHOW_OTP` | Test OTP ko'rsatish (production'da majburiy `false`) | `false` | **Majburiy** |
| `OTP_MODE` | OTP yuborish rejimi (`live` yoki `auto`) | `live` | **Majburiy** |
| `DATABASE_URL` | PostgreSQL ulanish manzili (bo'sh bo'lsa SQLite ishlatiladi) | `postgresql://user:pass@host:5432/db` | Ixtiyoriy |
| `DAILY_MESSAGE_LIMIT` | Kunlik bepul xabarlar chegarasi | `30` | Tavsiya etiladi |

> [!IMPORTANT]
> **Xavfsiz SESSION_SECRET yaratish buyrug'i:**
> ```bash
> python3 -c "import secrets; print(secrets.token_urlsafe(48))"
> ```

---

## 3. Variant A: Docker va Docker Compose orqali deploy

Docker ko'p bosqichli (`multi-stage`) build orqali frontendni yig'adi va Python konteynerida ishga tushiradi.

### 1-qadam: Loyihani serverga yuklash
```bash
git clone <sizning-repo-manzilingiz> /opt/navo-ai
cd /opt/navo-ai
```

### 2-qadam: `.env` faylini sozlash
```bash
cp .env.example .env
nano .env
```
Kerakli API kalitlar, domen nomi va `SESSION_SECRET` ni kiriting.

### 3-qadam: Konteynerni ishga tushirish
```bash
docker compose up -d --build
```

### 4-qadam: Tekshirish
```bash
docker compose ps
curl http://127.0.0.1:5507/health
# Natija: {"status":"ok"}
```

---

## 4. Variant B: Ubuntu VPS (Nginx + Systemd + Certbot SSL)

Agar ilovani to'g'ridan-to'g'ri Ubuntu 22.04 / 24.04 serverida Nginx bilan ishlatmoqchi bo'lsangiz:

### 1-qadam: Kerakli tizim paketlarini o'rnatish
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx certbot python3-certbot-nginx curl git
```

### 2-qadam: Loyiha kodini joylashtirish
```bash
sudo mkdir -p /var/www/navo-ai
sudo chown -R $USER:$USER /var/www/navo-ai
git clone <sizning-repo-manzilingiz> /var/www/navo-ai
cd /var/www/navo-ai
```

### 3-qadam: Virtual muhit va bog'liqliklarni o'rnatish
```bash
# Python virtual muhiti
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt

# Node.js paketlari va frontend build
npm install
npm run build
```

### 4-qadam: `.env` faylini sozlash
```bash
cp .env.example .env
nano .env
```

### 5-qadam: Systemd xizmatini sozlash
```bash
sudo cp deploy/navo-ai.service /etc/systemd/system/navo-ai.service

# Xizmatni ishga tushirish
sudo systemctl daemon-reload
sudo systemctl enable navo-ai
sudo systemctl start navo-ai
sudo systemctl status navo-ai
```

### 6-qadam: Nginx va Let's Encrypt (HTTPS) sozlash
1. Nginx konfiguratsiyasini ko'chiring:
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/navo-ai
```
2. Faylni ochib, `yourdomain.com` o'rniga o'z domeningizni yozing:
```bash
sudo nano /etc/nginx/sites-available/navo-ai
```
3. Saytni faollashtiring:
```bash
sudo ln -s /etc/nginx/sites-available/navo-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```
4. Let's Encrypt orqali bepul SSL sertifikat oling:
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## 5. Yangilash tartibi (Update Guide)

Kodingizga yangi o'zgarishlar kiritilganda, production serverda quyidagi amallarni bajaring:

### Docker orqali yangilash:
```bash
cd /opt/navo-ai
git pull origin main
docker compose up -d --build
```

### VPS (Systemd) orqali yangilash:
```bash
cd /var/www/navo-ai
git pull origin main
source .venv/bin/activate
pip install -r backend/requirements.txt
npm install
npm run build
sudo systemctl restart navo-ai
```

---

## 6. Monitoring, Loglarni ko'rish va Healthcheck

### 1. Healthcheck tekshiruvi:
Serverning ishlash holatini istalgan monitoring tizimi (UptimeKuma, BetterStack) orqali kuzatish mumkin:
```bash
curl -I https://yourdomain.com/health
# HTTP/2 200
# {"status":"ok"}
```

### 2. Loglarni jonli kuzatish:
**Docker uchun:**
```bash
docker compose logs -f --tail=100 app
```

**Systemd (VPS) uchun:**
```bash
sudo journalctl -u navo-ai -f -n 100
```

**Nginx loglari:**
```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

---

## 7. Qo'lda bajarilishi kerak bo'lgan ishlar ro'yxati

Quyidagi amallarni faqat server egasi (administrator) o'z hisoblarida qo'lda bajarishi lozim:

1. **DNS (Domen) sozlamalari**:
   - Domeningiz provayderida (Cloudflare, Reg.ru, Namecheap) `A` yozuvini (A record) VPS serveringizning ommaviy IP manziliga yo'naltiring.

2. **Google Cloud Console (Google orqali kirish uchun)**:
   - [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services** -> **Credentials**.
   - OAuth 2.0 Client ID sozlamalarida:
     - **Authorized JavaScript origins**: `https://yourdomain.com`
     - **Authorized redirect URIs**: `https://yourdomain.com/api/auth/google/callback`

3. **Email xizmati**:
   - **Gmail SMTP ishlatilsa**: Google hisobingizda 2 bosqichli tekshiruvni yoqing va maxsus *App Password* (Ilova paroli) olib, `.env` dagi `SMTP_PASSWORD` ga kiriting.
   - **Chiquvchi SMTP portlari (465/587) hosting tomonidan yopiq bo'lsa**: `.env` da `EMAIL_PROVIDER=resend` yoki `EMAIL_PROVIDER=brevo` qilib, tegishli HTTP API kalitini kiriting (chunki HTTP 443 port hech qachon bloklanmaydi).

4. **Xavfsizlik**:
   - `.env` faylini hech qachon Git'ga commit qilmang.
   - `SESSION_SECRET` ni kamida 32 ta belgidan iborat tasodifiy satr qilib belgilang.
