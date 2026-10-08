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

Sayt faqat shu manzildan ochiladi:

<http://127.0.0.1:5507>

Login, SMS, Google OAuth va Gemini so'rovlari faqat shu serverda ishlaydi:
maxfiy kalitlar shu yerda saqlanadi. `frontend/src/` ichidagi o'zgarishlarni yig'ib
5507-portda ko'rish uchun `run.bat` ni qayta ishga tushiring.

## 1a. Development — React + FastAPI

```text
npm install
python -m pip install -r requirements.txt
npm run dev
```

`npm run dev` FastAPI'ni `http://127.0.0.1:5507` va Vite'ni
`http://127.0.0.1:5173` manzillarida birgalikda ishga tushiradi. Vite `/api`
so'rovlarini FastAPI'ga proxy qiladi; development frontend va backend orasida
alohida CORS yoki API URL sozlamasi kerak emas.

`npm start` yig'ilgan frontend va API'ni `http://127.0.0.1:5507` da bitta
serverdan uzatadi. 5507-portda FastAPI ishlaganda VS Code Live Server/Go Live'ni
yoqmang; frontend ustida ishlash uchun `npm run dev` dan foydalaning.

## 1c. Premium taqdimot sahifasi — `/showcase/`

`showcase/` — Navo AI'ga olib boradigan mustaqil landing sahifa: suyuq maxsus
kursor, Lenis silliq scroll, GSAP (ScrollTrigger) animatsiyalari, Three.js
zarrachali fon, magnit tugmalar, 3D tilt kartalar va drag galereya.

```text
http://127.0.0.1:5507/showcase/
```

Sahifa FastAPI statik mount orqali uzatiladi (`backend/main.py` → `app.mount("/showcase")`),
shuning uchun alohida server kerak emas. Barcha kutubxonalar `showcase/vendor/`
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
ES-modullarni bloklaydi. Faqat `http://127.0.0.1:5507/showcase/` manzilidan
oching. Sensorli ekranda kursor avtomatik o'chadi, `prefers-reduced-motion`
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
http://localhost:5507
http://127.0.0.1:5173
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
`FRONTEND_ORIGIN` OAuth tugagach foydalanuvchini frontendga qaytaradi.
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
Frontend API so'rovlari nisbiy `/api/...` yo'llardan foydalanadi. Vercel'da
alohida frontend deploy qilish yoki `VITE_API_URL` o'rnatish shart emas.

Render'da maxfiy backend sozlamalarini **Environment Variables** bo'limida
kiriting: `GEMINI_API_KEY`, `SESSION_SECRET`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`; Google login uchun `GOOGLE_CLIENT_ID` va
`GOOGLE_CLIENT_SECRET`; SMS uchun `ESKIZ_EMAIL` va `ESKIZ_PASSWORD`.
`APP_ORIGIN` bo'sh qoldirilsa, Render bergan `RENDER_EXTERNAL_URL` ishlatiladi.
`FRONTEND_ORIGIN` bo'sh qoldirilsa, frontend origini backend bilan bir xil
bo'ladi. Render'da oldin Vercel frontend domeni `FRONTEND_ORIGIN` qilib
saqlangan bo'lsa, uni o'chiring yoki joriy Render originiga almashtiring. Shu
bois production'da credential cookie uchun same-origin sozlamasi ishlaydi.

Google OAuth ishlatilsa, Render service originini Google Cloud Console'da
Authorized JavaScript origin sifatida va
`<RENDER_EXTERNAL_URL>/api/auth/google/callback` ni Authorized redirect URI
sifatida qo'shing. `GOOGLE_REDIRECT_URI` ni Render'da xuddi shu callback URL
qilib belgilash mumkin.

`GET /api/health` server sog'ligini `{"status":"ok"}` bilan tekshiradi.
Frontenddagi `/profile`, `/dashboard` kabi GET yo'llar React build `index.html`
ga qaytadi; noma'lum `/api/...` yo'llar esa API 404 sifatida qoladi. SQLite
saqlash joyi `NAVO_DB_PATH` bilan sozlanadi (default `app.db`); Render lokal
diskini restart/deploy orasida saqlamaydi. Doimiy foydalanuvchi ma'lumotlari
kerak bo'lsa, Render persistent diskni `NAVO_DB_PATH` bilan ulash yoki keyinroq
managed database tanlash kerak bo'ladi.

Tekshirish uchun: `npm run build`, so'ng `npm start`; `http://localhost:5507/`
frontendni, `http://localhost:5507/api/health` API'ni ochadi.
