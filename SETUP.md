# Navo AI'ni ishga tushirish

Loyiha endi clean monorepo tuzilishga ega: **FastAPI backend** (`backend/`),
**Vite + React frontend** (`frontend/`) va **premium taqdimot sahifasi**
(`frontend/showcase/` — HTML + Tailwind + GSAP + Lenis + Three.js).

Bu paketda maxfiy kalitlar yo'q. Mijoz `.env.example` nusxasini `.env` qilib,
o'zining Gemini, SMS va Google credentiallarini kiritadi. `.env` faylini ZIP
orqali boshqa odamga yubormang.

## 1. To'liq sayt — bitta manzil (5507)

`run.bat` faylini ikki marta bosing. U virtual muhit yaratadi, Python
paketlarini o'rnatadi, frontendni yig'adi (`npm run build`) va serverni ishga
tushiradi. Sayt ishlayotganda ochilgan terminal oynasini yopmang.

Landing page shu manzilda, mavjud React ilovasi esa `/app/` yo'lida ochiladi:

<http://127.0.0.1:5507>
<http://127.0.0.1:5507/app/>

`/app/` sessiyani tekshiradi: login qilmagan mehmon mavjud ro'yxatdan
o'tish/kirish sahifasini, login qilgan foydalanuvchi Navo AI chatini ko'radi.
Login, email/SMS tasdiqlash, Google OAuth va Gemini so'rovlari shu FastAPI
serverida ishlaydi. Frontend o'zgarishlarini yig'ish uchun `run.bat` ni qayta
ishga tushiring.

## 1a. Development — bitta server

```text
npm install
python -m pip install -r requirements.txt
npm run dev
```

`npm run dev` aslida bitta FastAPI ilovasi orqali 5507-portda ishlaydigan
asosiy serverni ishga tushiradi. Bu yerda alohida Vite yoki Live Server kerak
emas: React build qilinadi; FastAPI `http://127.0.0.1:5507/` manzilda landing
page'ni, `/app/` manzilda esa React ilovasini xizmat qiladi.

`npm start` ishlab chiqarish rejimi bo'lib, frontend build dan keyin FastAPI
landing page, `/app/` React ilovasi va `/api/*` endpointlarni bitta origin'dan
xizmat qiladi.

VS Code'da Chrome'ni avtomatik ochib, aynan FastAPI serverini boshlash uchun
`Ctrl+Shift+B` (`Tasks: Run Build Task`) tugmalarini bosing. Default
`Navo AI Go Live (Chrome, 5507)` task frontendni yig'ib, FastAPI'ni ishga tushiradi,
tayyor bo'lishini kutadi va Google Chrome'da `http://127.0.0.1:5507/` ni
ochadi. Har ishga tushganda React build yangilanadi. Server sog'lom holda
ishlayotgan bo'lsa, ikkinchi backend ochilmaydi. Terminaldan ham `npm run go-live`
ishlatish mumkin. Agar `frontend/index.html` mavjud bo'lmasa-yu, tayyor
`frontend/dist` build saqlangan bo'lsa, task buildni o'tkazib yuboradi va bu
haqda ogohlantiradi. Manba Vite entry fayli `frontend/index.html` mavjud bo'lsa,
har safar serverni yangidan boshlashdan oldin React frontend qayta yig'iladi.

VS Code profilida Live Server (`ritwickdey.liveserver` 5.7.10) o'rnatilgan.
Uning `Go Live` buyrug'i FastAPI'ni ishga tushirmaydi: workspace papkasini
statik fayl serverida (odatda 5500-port) ko'rsatadi. Shu sabab
`/frontend/showcase/index.html` ochilgan. Workspace sozlamalari extension
buyrug'ini boshqa task bilan almashtira olmaydi; 5500-portdagi Live Server
alohida server bo'lib qoladi va uni bu loyiha ishga tushirish jarayoni
boshqarmaydi.

Live Server extension'ining status-bar tugmasi ko'rinadi. Workspace sozlamasi
`/frontend` papkasini statik root qilib, `5500` portga biriktiradi. Shu sabab
`frontend/showcase/index.html` fayli Live Server orqali
`http://127.0.0.1:5500/showcase/index.html` manzilida ochiladi. Agar server
eski root (`/frontend/showcase`) bilan avvaldan ishga tushgan bo'lsa,
`/showcase/index.html` uchun `Cannot GET` qaytarishi mumkin: yangi root sozlamasi
allaqachon ishlayotgan instance'ga avtomatik qo'llanmaydi. `Live Server: Stop
Live Server` qilib, qayta `Go Live` bosish kerak. Uning lokal yo'naltirishi
FastAPI tayyor bo'lsa, brauzerni `5507` dagi haqiqiy ilovaga olib o'tadi.
Live Server faqat statik fayllarni xizmat qiladi; FastAPI'ni ishga tushirmaydi
va `5507` portini band qilmasligi kerak.

Extension'ning original `Go Live` buyrug'i FastAPI'ni ishga tushirmaydi.
`5507` portdan FastAPI foydalanadi, aks holda port to'qnashadi. Shu sabab
original tugma extension'ning statik preview vazifasida qoladi.
`Ctrl+Shift+B` (`Tasks: Run Build Task`) — ushbu loyiha uchun to'liq
bir-serverli amal:
U frontendni build qiladi, FastAPI'ni 5507-portda boshlaydi yoki sog'lom
mavjud ilovani qayta ishlatadi, so'ng Chrome'da to'g'ri URL'ni ochadi.

`npm start` FastAPI ishga tushishida terminalga manzilni chiqaradi, API va
frontend tayyor bo'lishini kutadi. 5507-portda shu Navo AI allaqachon ishlasa,
ikkinchi server ochmasdan mavjud ilovani taniydi; boshqa jarayon band
qilgan bo'lsa, jarayon PID'sini ko'rsatib to'xtaydi.

## 1c. Premium landing page

`showcase/` — Navo AI'ga olib boradigan mustaqil landing sahifa: suyuq maxsus
kursor, Lenis silliq scroll, GSAP (ScrollTrigger) animatsiyalari, Three.js
zarrachali fon, magnit tugmalar, 3D tilt kartalar va drag galereya.

Asosiy landing sahifa `http://127.0.0.1:5507/` da beriladi; xuddi shu
statik fayllar `/showcase/` ostida ham mavjud. FastAPI mount tufayli alohida
server kerak emas. Barcha kutubxonalar `showcase/vendor/`
ichida lokal saqlanadi (internet talab qilinmaydi), shriftlar Google Fonts'dan
yuklanadi.

Tuzilishi:

```text
showcase/
  index.html            sahifa tuzilishi (Tailwind klasslari bilan)
  css/showcase.css      dizayn tizimi: o'zgaruvchilar, kursor, reveal holatlari
  js/main.js            kirish nuqtasi (modullarni xatoga chidamli ishga tushiradi)
  js/cursor.js          inertiyali kursor, izohli holatlar, zarracha izi
  js/smooth-scroll.js   Lenis + ScrollTrigger sync, parallax, faol bo'lim
  js/reveal.js          kinetik matn (so'z/harf), scroll-reveal, hisoblagichlar
  js/scene.js           WebGL zarrachalar (Canvas 2D zaxira rejimi bilan)
  js/interactions.js    magnit tugmalar, 3D tilt, drag galereya, marquee
  vendor/               gsap, ScrollTrigger, lenis, tailwind, three
  assets/               logo.svg, logo-192.png
```

Muhim: sahifani `file://` orqali (faylni ikki marta bosib) ochmang — brauzer
ES-modullarni bloklaydi. Landing `http://127.0.0.1:5507/`, React ilova esa
`http://127.0.0.1:5507/app/` manzilida. Sensorli ekranda kursor avtomatik o'chadi, `prefers-reduced-motion`
yoqilgan bo'lsa animatsiyalar to'xtaydi va statik fon ko'rsatiladi.

## 2. `.env` sozlash

`.env.example` faylidan `.env` nusxa oling va quyidagilarni to'ldiring:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
SESSION_SECRET=CHANGE_ME
APP_ORIGIN=http://127.0.0.1:5507
FRONTEND_ORIGIN=http://127.0.0.1:5507
GOOGLE_REDIRECT_URI=http://127.0.0.1:5507/api/auth/google/callback
ESKIZ_EMAIL=...
ESKIZ_PASSWORD=...
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
DEV_SHOW_OTP=false
OTP_MODE=live
```

Telefon OTP uchun Eskiz akkaunti va SMS balansi kerak. Haqiqiy email OTP uchun
Gmail App Password yarating, `.env` ichida `SMTP_HOST=smtp.gmail.com`,
`SMTP_PORT=465`, Gmail manzili va App Password qiymatlarini to'ldiring va
`DEV_SHOW_OTP=false` qoldiring. Email `Navo AI` nomidan `🔐 Navo AI tasdiqlash
kodi` mavzusi bilan HTML va oddiy matn ko'rinishida yuboriladi. Kod 6 xonali,
5 daqiqa amal qiladi; qayta yuborish orasida 60 soniya kutish bor.
Port 465 implicit SSL (`SMTP_SSL`) bilan ishlatiladi; boshqa SMTP portlarda
backend STARTTLS yoqadi. Render loglarida SMTP serveridan kelgan haqiqiy xato
matni traceback bilan yoziladi.

Gemini modeli javob bermasa yoki sekinlashsa, backend sozlangan modelni
birinchi bo'lib sinab, keyin API kalitiga mos mavjud zaxira modellarni tekshiradi.
Hozirgi lokal sozlamada `GEMINI_MODEL=gemini-3.6-flash`; har bir model 25 soniya
ichida javob bermasa, avtomatik ravishda keyingisiga o'tadi.

Mahalliy sinovda OTPni ekranda ko'rsatish uchun `DEV_SHOW_OTP=true` qiling:
email/SMS yuborilmaydi. Haqiqiy SMS/email uchun tegishli xizmat ma'lumotlarini
kiriting, `DEV_SHOW_OTP=false`, `OTP_MODE=live` qoldiring. Shunda xizmat
sozlanmagan bo'lsa demo-kod qaytarilmaydi va API aniq xato qaytaradi.

## 3. Google orqali kirish

Google Cloud Console'da OAuth Client ID (Web application) yarating. Mahalliy
sinov uchun Authorized JavaScript origins:

```text
http://127.0.0.1:5507
```

Authorized redirect URI:

```text
http://127.0.0.1:5507/api/auth/google/callback
```

Google Console'dagi redirect URI va backend yuboradigan URI protokol, host,
path va oxirgi slashgacha aynan bir xil bo'lishi shart. Backend `APP_ORIGIN`,
keyin Render bergan `RENDER_EXTERNAL_URL` dan foydalanadi; ulardan hech biri
bo'lmasa lokal manzil ishlatiladi.

Mahalliy `.env` ichiga:

```env
APP_ORIGIN=http://127.0.0.1:5507
FRONTEND_ORIGIN=http://127.0.0.1:5507
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:5507/api/auth/google/callback
```

`.../api/auth/google/callback` va `.../api/auth/callback/google` Google uchun
turli URI hisoblanadi; boshlash va token almashish birinchi URI dan foydalanadi.
`FRONTEND_ORIGIN` OAuth tugagach foydalanuvchini `/app/` React auth sahifasiga
qaytaradi.
Google OAuth muvaffaqiyatli tugagach, Google profilingizdagi
tasdiqlangan emailga alohida 6 xonali OTP yuboriladi. Kod 5 daqiqa amal qiladi,
qayta yuborish tugmasi 60 soniyadan so'ng faollashadi; kod tasdiqlanmaguncha
sessiya ochilmaydi. Shu sabab Google OTP uchun Gmail SMTP sozlamalari majburiy
va `DEV_SHOW_OTP=true` bu bosqichni chetlab o'tmaydi. Keyin backendni qayta
ishga tushiring. Google login faqat credentiallar, SMTP va mos redirect URI bilan
ishlaydi. Email/SMS/Google tasdiqlangach va login bo'lgach, backend 30 kunlik
HttpOnly cookie o'rnatadi; JSON javobidagi
`access_token` ham HS256 bilan imzolangan JWT bo'ladi. `SESSION_SECRET` uchun
uzun, tasodifiy qiymat kiriting.
Uni yaratish uchun terminalda `python -c "import secrets; print(secrets.token_urlsafe(48))"`
buyrug'ini ishlating. Qisqa yoki namuna qiymat bilan backend vaqtinchalik JWT
kalitidan foydalanadi, server qayta ishga tushganda sessiyalar yangidan kirishni
talab qiladi.

## 4. Bitta serverga deploy — Render

Loyiha Render'da bitta **Python Web Service** sifatida ishlaydi. Render blueprint
`render.yaml` ichida quyidagi buyruqlar allaqachon sozlangan:

```text
Build: npm install && pip install -r backend/requirements.txt && npm run build
Start: npm start
```

GitHub repository'ni Render Blueprint yoki Web Service orqali deploy qiling.
Build React frontendni `frontend/dist/` ichiga yig'adi; `npm start` esa `process.env.PORT`
ni `0.0.0.0` manzilida tinglaydigan FastAPI serverini ishga tushiradi. FastAPI
`frontend/dist/` fayllarini va `/api/...` marshrutlarini bitta origin'dan beradi.
Frontend API so'rovlari nisbiy `/api/...` yo'llardan foydalanadi. Netlify bu
FastAPI serverini oddiy statik sayt kabi ishga tushira olmaydi; frontend va
backendni bitta origin'da yuritish uchun Render Web Service ishlating.
Vercel'da alohida frontend deploy qilish yoki `VITE_API_URL` o'rnatish kerak emas.

Render'da repository'ni Web Service/Blueprint qilib ulang. `render.yaml` build,
start, health check va SMTP defaultlarini sozlaydi. Blueprint maxfiy qiymatlarni
so'raydi; ularni faqat Render **Environment Variables** bo'limiga kiriting,
GitHub yoki chatga yozmang:

- Majburiy: `GEMINI_API_KEY`, `DATABASE_URL` (Neon PostgreSQL ulanish manzili),
  `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`
- `SESSION_SECRET` blueprint tomonidan avtomatik yaratiladi.
- Google login uchun: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- SMS uchun: `ESKIZ_EMAIL`, `ESKIZ_PASSWORD`
- Lokal Gmail SMTP uchun: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
  `SMTP_USER`, `SMTP_PASSWORD` (Google App Password). Lokal `.env`'da
  `EMAIL_PROVIDER=smtp` qoldiring.

Render Free blueprint `EMAIL_PROVIDER=brevo` bilan keladi. `/api/health`
health check deploy muvaffaqiyatini tekshiradi; React va `/api/*` bitta Render
manzilidan ishlaydi. `APP_ORIGIN` bo'sh bo'lsa Render bergan
`RENDER_EXTERNAL_URL` avtomatik ishlatiladi. `FRONTEND_ORIGIN` ham shu origin'ga
teng bo'ladi.

### Bepul PostgreSQL'ni ulash va lokal SQLite'ni ko'chirish

Render free servisining diskida SQLite bazani doimiy saqlab bo'lmaydi. Bepul
[Neon PostgreSQL](https://neon.com/pricing) loyihasi yarating, connection string'ni mahalliy `.env` ichiga
`MIGRATION_DATABASE_URL=...` sifatida vaqtincha kiriting va bir martalik
migratsiyani bajaring:

```text
python scripts/migrate-sqlite-to-postgres.py
```

Skript `NAVO_DB_PATH` ko'rsatgan lokal `backend/app.db` faylini ko'chiradi;
faqat bo'sh PostgreSQL bazasiga yozadi va mavjud ma'lumotlarni ustidan
yozmaydi. Muvaffaqiyatli bo'lgach, o'sha Neon connection string'ni Render'dagi
`DATABASE_URL` secret'iga kiriting va deploy qiling. `REQUIRE_DATABASE_URL`
yoqilganligi sabab Render'da bu secret bo'lmasa backend xato bilan to'xtaydi
(ephemeral SQLite'ga jimgina o'tmaydi). Lokal `.env`-da `DATABASE_URL` bo'sh
qolganda dastur avvalgidek SQLite'dan foydalanadi.

Migratsiya faqat sizning kompyuteringizdagi SQLite faylini ko'chiradi; hozirgi
Render free servisi ichida bo'lgan bazani avtomatik yuklab olmaydi. Agar ishlab
turgan Render hisoblarida kerakli ma'lumotlar bo'lsa, eski bazani avval alohida
eksport/import qilish kerak. Connection string'ni repo yoki chatga joylamang.

Mahalliy SMTP sinovida `smtp.gmail.com` ga TCP ulanishi ishladi, ammo 465
(implicit TLS) va 587 (STARTTLS) portlarida `authentication` bosqichida
`SMTPServerDisconnected: Connection unexpectedly closed` qaytdi. Demak portni
almashtirishning o'zi sababni tuzatgani yo'q. Yangi App Password yarating yoki
to'g'ri qiymat kiritilganini tekshiring; maxfiy qiymatni hech kimga yubormang.
Backend xato turini va maxfiy qiymatlarsiz SMTP xabarini server logiga yozadi.
Render'ning rasmiy hujjatiga ko'ra, **free web service** tashqi `25`, `465`,
`587` SMTP portlariga chiqolmaydi ([Render free instance limitations](https://render.com/docs/free)).
Shu sabab Render Free'da transactional email HTTPS API bilan yuboriladi:
Brevo'da sender email manzilini tasdiqlang, so'ng `BREVO_API_KEY` va
`BREVO_SENDER_EMAIL` qiymatlarini Render Environment Variables'ga kiriting.
Brevo endpoint va `api-key` header'i haqida [rasmiy API hujjati](https://developers.brevo.com/docs/send-a-transactional-email)
bor. Sender manzilini Brevo'da avval ro'yxatdan o'tkazish va tasdiqlash shart
([sender setup](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)).
Email tasdiqlashni chetlab o'tish yoki yuborilmagan xatni muvaffaqiyatli deb
ko'rsatish mumkin emas.

Google OAuth ishlatilsa, Render service originini Google Cloud Console'da
Authorized JavaScript origin sifatida va
`<RENDER_EXTERNAL_URL>/api/auth/google/callback` ni Authorized redirect URI
sifatida qo'shing. `GOOGLE_REDIRECT_URI` ni Render'da xuddi shu callback URL
qilib belgilash mumkin.

`GET /api/health` server sog'ligini `{"status":"ok"}` bilan tekshiradi.
`/app/profile`, `/app/dashboard` kabi app GET yo'llar React build `index.html`
ga qaytadi; noma'lum `/api/...` yo'llar esa API 404 sifatida qoladi. Lokal
ishlashda `DATABASE_URL` bo'sh bo'lsa SQLite `NAVO_DB_PATH` manzilidan
foydalanadi. Render'da `DATABASE_URL` Neon PostgreSQL'ga ulanadi, shuning uchun
foydalanuvchi, sessiya, tasdiqlash kodi va suhbatlar web-servis restart/deploy
qilinganda saqlanadi.

Tekshirish uchun: `npm run build`, so'ng `npm start`;
`http://127.0.0.1:5507/` landing page'ni,
`http://127.0.0.1:5507/app/` React ilovasi va auth sahifasini,
`http://127.0.0.1:5507/api/health` API'ni ochadi.
