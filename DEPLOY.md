# 🚀 Navo AI — Production Deploy Bo'yicha To'liq Qo'llanma

Ushbu qo'llanmada **Navo AI** ilovasini production muhitida (Render, VPS, Docker, Railway, Fly.io) xavfsiz va to'g'ri ishga tushirish bo'yicha to'liq qadamlar keltirilgan.

---

## 📋 Mundarija
1. [Arxitektura va umumiy ma'lumot](#1-arxitektura-va-umumiy-malumot)
2. [Muhit o'zgaruvchilari (.env jadvali)](#2-muhit-ozgaruvchilari-env-jadvali)
3. [Variant A: Docker va Docker Compose orqali deploy (Tavsiya etiladi)](#3-variant-a-docker-va-docker-compose-orqali-deploy)
4. [Variant B: Ubuntu VPS (Nginx + Systemd + Certbot SSL) orqali deploy](#4-variant-b-ubuntu-vps-nginx--systemd--certbot-ssl)
5. [Yangilash tartibi (Update Guide)](#5-yangilash-tartibi-update-guide)
6. [Monitoring, Loglarni ko'rish va Healthcheck](#6-monitoring-loglarni-korish-va-healthcheck)
7. [Qo'lda bajarilishi kerak bo'lgan ishlar ro'yxati](#7-qolda-bajarilishi-kerak-bolgan-ishlar-royxati)
8. [Render + PostgreSQL + Brevo](#8-render--postgresql--brevo)

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
| `CORS_ALLOWED_ORIGINS`| CORS ruxsat etilgan originlar (vergul bilan; boshqa origin kerak bo'lsa) | `https://yourdomain.com` | Domenlarga bog'liq |
| `SESSION_SECRET` | Sessiya va JWT shifrlash kaliti (kamida 32 ta belgi) | *Tasodifiy 64 belgili satr* | **Majburiy (Production'da)** |
| `FORWARDED_ALLOW_IPS` | Reverse proxy IP manzillari | `*` yoki `127.0.0.1` | **Majburiy (Nginx ortida)** |
| `GEMINI_API_KEY` | Google Gemini AI kaliti | `AIzaSy...` | **Majburiy** |
| `GEMINI_MODEL` | Gemini modeli | `gemini-flash-latest` | Tavsiya etiladi |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `...apps.googleusercontent.com` | Google auth uchun |
| `GOOGLE_CLIENT_SECRET`| Google OAuth Client Secret | `GOCSPX-...` | Google auth uchun |
| `GOOGLE_REDIRECT_URI` | Google OAuth qaytish manzili; avtomatik hosil qilinmaydi | `https://yourdomain.com/api/auth/google/callback` | Google auth uchun |
| `EMAIL_PROVIDER` | Email provayderi (`smtp`, `brevo` yoki `resend`) | `smtp` | Ixtiyoriy |
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
curl -i https://yourdomain.com/api/health
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
   - Render Free'da `EMAIL_PROVIDER=brevo` belgilang, Brevo'da sender emailni tasdiqlang va `BREVO_API_KEY` hamda `BREVO_SENDER_EMAIL` ni sozlang. Bu tanlovda backend Brevo HTTPS API ishlatadi, SMTP portiga ulanmaydi.
   - Lokal SMTP sozlamali o'rnatmalar avvalgidek ishlashi uchun `EMAIL_PROVIDER` ni ko'rsatmasangiz SMTP default bo'lib qoladi; SMTP tanlovini Render Free'da ishlatmang.

4. **Xavfsizlik**:
   - `.env` faylini hech qachon Git'ga commit qilmang.
   - `SESSION_SECRET` ni kamida 32 ta belgidan iborat tasodifiy satr qilib belgilang.

---

## 8. Render + PostgreSQL + Brevo

Render'da `render.yaml` dagi yagona Python Web Service'ni yarating. U frontendni deploy build bosqichida yig'adi, FastAPI esa `frontend/dist/` ni beradi; `npm start` build qilmaydi va Render bergan `PORT` portida tinglaydi. Build buyrug'i:

```sh
npm install && pip install -r backend/requirements.txt && npm run build
```

`package-lock.json` loyiha ildizida saqlanadi; Python bog'liqliklari `backend/requirements.txt` dan o'rnatiladi. Render native runtime'lari Debian 12 asosida bo'lib, Python runtime'da `node`, `npm`, `python3` va `pip` mavjud; shu sababli buyruqlar bitta Python web service build muhitida bajariladi. Render konfiguratsiyasidagi Python versiyasi `3.11.11`. Build muvaffaqiyatsiz bo'lsa, Render Build Logs'da `npm install`, `pip install` yoki `npm run build` bosqichidagi xatoni tekshiring. Start jarayonida dist yo'q bo'lsa server aniq xato bilan to'xtaydi.

### Render muhit o'zgaruvchilari

`render.yaml` avtomatik belgilaydigan `ENVIRONMENT=production`, `HOST=0.0.0.0`, `REQUIRE_DATABASE_URL=true`, `EMAIL_PROVIDER=brevo` va `DEV_SHOW_OTP=false` ni o'zgartirmang. Quyidagi `sync: false` qiymatlarini Render Dashboard'da to'ldiring:

| O'zgaruvchi | Maxfiymi? | Qiymat qayerdan olinadi / nimaga bog'liq |
| --- | --- | --- |
| `DATABASE_URL` | Ha | Neon yoki Supabase PostgreSQL loyihasining pooled/direct ulanish URI'si. `sslmode` berilmagan URI'ga ilova `sslmode=require` qo'shadi; mavjud `sslmode` saqlanadi. |
| `APP_ORIGIN` | Yo'q | Render Web Service domeni yoki biriktirilgan custom domain, `https://` bilan va oxirgi `/` siz. |
| `FRONTEND_ORIGIN` | Yo'q | Shu yagona servisdagi frontend origin; odatda `APP_ORIGIN` bilan bir xil. |
| `CORS_ALLOWED_ORIGINS` | Yo'q | Ruxsat etiladigan aniq origin(lar), masalan servisning HTTPS origin'i; bir nechta qiymat vergul bilan. `*` ishlatmang. |
| `GOOGLE_REDIRECT_URI` | Yo'q | `APP_ORIGIN` + `/api/auth/google/callback`. Xuddi shu URI Google Cloud OAuth Client'dagi **Authorized redirect URIs** ga kiritilsin. |
| `GEMINI_API_KEY` | Ha | Google AI Studio'dan olingan API key. |
| `SESSION_SECRET` | Ha | `render.yaml` Render'da tasodifiy qiymat yaratadi; kamida 32 belgili bo'lishi kerak. |
| `BREVO_API_KEY` | Ha | Brevo hisobidagi transactional API key. |
| `BREVO_SENDER_EMAIL` | Yo'q | Brevo'da tasdiqlangan sender emaili; domen Brevo'da autentifikatsiya qilingan bo'lishi kerak. |
| `GOOGLE_CLIENT_ID` | Yo'q | Google Cloud Console OAuth 2.0 Client ID. |
| `GOOGLE_CLIENT_SECRET` | Ha | Shu OAuth Client uchun Google Cloud Console'dagi client secret. |
| `ESKIZ_EMAIL` | Ha | SMS ishlatilsa Eskiz login. Email uchun shart emas. |
| `ESKIZ_PASSWORD` | Ha | SMS ishlatilsa Eskiz paroli. Email uchun shart emas. |

`PORT` ni qo'lda kiritmang: Render uni runtime'da beradi. `PYTHON_VERSION`, `HOST`, `ENVIRONMENT`, `REQUIRE_DATABASE_URL`, `EMAIL_PROVIDER`, `DEV_SHOW_OTP` va `OTP_MODE` esa `render.yaml` dagi qiymatlar bilan beriladi. Google OAuth ishlatmasangiz, callback sozlamalari zarur emas, lekin `GOOGLE_REDIRECT_URI` kiritilmaguncha Google login ishlamaydi. CORS middleware faqat `CORS_ALLOWED_ORIGINS` dagi originlarga ruxsat beradi; yagona domenli frontend/API uchun shu domenni kiriting.

### SQLite ma'lumotlarini PostgreSQL'ga ko'chirish

`scripts/migrate-sqlite-to-postgres.py` lokal `backend/app.db` (yoki `NAVO_DB_PATH`) ni `MIGRATION_DATABASE_URL` ga ko'chiradi; u bo'lmasa `DATABASE_URL` ni ishlatadi. Migratsiya maqsad PostgreSQL jadvallarida yozuv bo'lsa to'xtaydi va ma'lumot ustidan yozmaydi. Avval bo'sh Postgres bazasini tayyorlang. Migratsiya kodini import qilishda schema jadvallari yaratiladi, so'ng SQLite yozuvlari ko'chadi.

PowerShell'da lokal loyiha ildizidan ishga tushirish:

```powershell
$env:MIGRATION_DATABASE_URL = "<bo'sh PostgreSQL bazasining maxfiy URI qiymati>"
python .\scripts\migrate-sqlite-to-postgres.py
```

Linux/macOS'da:

```sh
read -rsp "MIGRATION_DATABASE_URL: " MIGRATION_DATABASE_URL
export MIGRATION_DATABASE_URL
echo
python scripts/migrate-sqlite-to-postgres.py
```

URI qiymatini buyruqlar tarixi/loglariga yozib qo'ymang. Ko'chirish tugagach, Render'dagi `DATABASE_URL` ni aynan maqsad bazaga sozlang va `REQUIRE_DATABASE_URL=true` ekanini tekshiring. Migratsiyadan keyin shu terminalda `psql "$MIGRATION_DATABASE_URL" -c 'SELECT COUNT(*) FROM users;'` bilan yozuvlarni tekshirish mumkin. Migratsiya deploy'dan oldin, SQLite fayli mavjud lokal muhitda bajariladi; Render Web Service'da alohida local SQLite fayli bo'lmaydi. Ushbu yo'riqnoma haqiqiy bazaga qarshi bajarilmadi.

### Deploy'dan keyin tekshirish ro'yxati

1. Render **Build Logs**'da `npm install`, `pip install` va `npm run build` muvaffaqiyatli tugaganini, **Deploy Logs**'da FastAPI `0.0.0.0` va Render bergan portda ishga tushganini tekshiring.
2. `https://<Render-domeni>/api/health` so'rovi `200` va `{"status":"ok"}` qaytarishi kerak; `render.yaml` health check ham shu yo'lni ishlatadi.
3. `DATABASE_URL` va `REQUIRE_DATABASE_URL=true` to'g'ri ekanini Render loglaridan tasdiqlang; ulanish xatosida URI/credential'ni log yoki chatga yubormang. Agar `REQUIRE_DATABASE_URL` o'chirilgan bo'lsa va `DATABASE_URL` berilmagan bo'lsa, backend SQLite'ga o'tadi va production logida `SQLite vaqtinchalik, qayta ishga tushganda akkauntlar o'chadi` ogohlantirishi chiqadi. Render Free'da lokal SQLite doimiy saqlanmaydi: foydalanuvchilar, OTP kodlari va sessiyalar restart/deploy'dan keyin yo'qolishi mumkin. Doimiy ishlatish uchun PostgreSQL ulang.
4. Sayt, ro'yxatdan o'tish va login'ni HTTPS orqali sinang. Production'da `DEV_SHOW_OTP=true` e'tiborga olinmaydi; OTP email orqali yuborilishi kerak.
5. Brevo sender domeni va API kalitini tekshiring. Xatolik bo'lsa loglarda HTTP status va javob tafsiloti bo'ladi; API key/parol loglanmaydi.
6. Google login ishlatilsa Google Console'dagi Authorized redirect URI `GOOGLE_REDIRECT_URI` bilan belgima-belgi mos bo'lsin. Brauzerda callbackdan keyin sessiya cookie'si `Secure` va `HttpOnly` bo'lishini tekshiring.
7. `APP_ORIGIN`, `FRONTEND_ORIGIN` va `CORS_ALLOWED_ORIGINS` qiymatlari real Render/custom domeniga mos bo'lsin.

### Lokal va Render farqi

| Lokal | Render |
| --- | --- |
| `.env` qo'lda boshqariladi; `DATABASE_URL` bo'sh bo'lsa `backend/app.db` SQLite ishlatiladi. | Sirlar va domenlar Render Environment Variables'da saqlanadi; `REQUIRE_DATABASE_URL=true` sababli `DATABASE_URL` bo'lmasa server aniq xato bilan startni to'xtatadi. Bu talab o'chirilgan bo'lsa SQLite vaqtinchalik ishlaydi va restart/deploy'da akkauntlar, kodlar hamda sessiyalar yo'qolishi mumkin. |
| `npm start` uchun `PORT` berilmasa `5507`; `run.bat` frontendni oldin build qiladi. | Render `PORT` ni runtime'da beradi; build faqat `buildCommand` da, start esa tayyor `frontend/dist/` ni talab qiladi. |
| `ENVIRONMENT=development` bo'lsa `DEV_SHOW_OTP=true` OTP'ni terminalga chiqaradi. | `ENVIRONMENT=production` da OTP terminalga chiqmaydi, hatto `DEV_SHOW_OTP=true` berilsa ham. |
| HTTP local origin va local SQLite. | HTTPS reverse proxy, production cookie (`Secure`) va managed PostgreSQL; callback/CORS originlar domenga bog'liq. |
