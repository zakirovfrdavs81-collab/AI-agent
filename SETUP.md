# Navo AI'ni ishga tushirish

Loyiha uch qismdan iborat: **FastAPI backend** (`main.py`), **Vite + React
frontend** (`src/`, `index.html`) va **premium taqdimot sahifasi**
(`showcase/` — HTML + Tailwind + GSAP + Lenis + Three.js).

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
maxfiy kalitlar shu yerda saqlanadi. `src/` ichidagi o'zgarishlarni yig'ib
5507-portda ko'rish uchun `run.bat` ni qayta ishga tushiring.

## 1a. Frontend ustida ishlash — Vite (5173, hot reload)

```text
npm install
npm run dev
```

Vite 5173-portda ishga tushadi: <http://127.0.0.1:5173>. Bu manzilda JSX
brauzer uchun avtomatik o'giriladi va har o'zgarish darhol ko'rinadi. Frontend
API so'rovlari lokal FastAPI'ning 5507-portiga yuboriladi. VS Code Live Server
esa yig'ilgan `dist` frontendni 5507-portda ochadi.

Frontenddagi barcha API so'rovlari `js/config.js` orqali
`http://127.0.0.1:5507` backendiga yuboriladi. FastAPI CORS sozlamasida Vite
uchun `http://127.0.0.1:5173` ham ruxsat etilgan.

5507-portni faqat FastAPI (`run.bat`) ishlatsin. Vite yoki Live Server'ni
5507-portda ishga tushirmang: ular FastAPI o'rnini egallab, API va statik
fayllar noto'g'ri manzildan kelishiga yoki oq sahifaga sabab bo'lishi mumkin.
VS Code pastidagi `5507` port havolasi saytni ochadi, lekin serverni o'zi
ishga tushirmaydi — avval terminalda `Uvicorn running on
http://127.0.0.1:5507` xabari chiqishi kerak.

## 1b. VS Code Live Server

Live Server frontendni `dist` papkasidan `http://127.0.0.1:5507` manzilida
ochadi. Backend uchun `run.bat` orqali 5507-portni ishga tushiring; frontend
API'ga CORS bilan ulanadi. `APP_ORIGIN=http://127.0.0.1:5507` va
`FRONTEND_ORIGIN=http://127.0.0.1:5507` bo'lishi kerak. O'zgartirilgan React
kodini Live Server'da ko'rishdan oldin `npm run build` bajaring.

## 1c. Premium taqdimot sahifasi — `/showcase/`

`showcase/` — Navo AI'ga olib boradigan mustaqil landing sahifa: suyuq maxsus
kursor, Lenis silliq scroll, GSAP (ScrollTrigger) animatsiyalari, Three.js
zarrachali fon, magnit tugmalar, 3D tilt kartalar va drag galereya.

```text
http://127.0.0.1:5507/showcase/
```

Sahifa FastAPI statik mount orqali uzatiladi (`main.py` → `app.mount("/showcase")`),
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
SMTP_PORT=587
DEV_SHOW_OTP=false
OTP_MODE=live
```

Telefon OTP uchun Eskiz akkaunti va SMS balansi kerak. Haqiqiy email OTP uchun
Gmail App Password yarating, `.env` ichida `SMTP_HOST=smtp.gmail.com`,
`SMTP_PORT=587`, Gmail manzili va App Password qiymatlarini to'ldiring va
`DEV_SHOW_OTP=false` qoldiring. Email `Navo AI` nomidan `🔐 Navo AI tasdiqlash
kodi` mavzusi bilan HTML va oddiy matn ko'rinishida yuboriladi. Kod 6 xonali,
5 daqiqa amal qiladi; qayta yuborish orasida 60 soniya kutish bor.

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
path va oxirgi slashgacha aynan bir xil bo'lishi shart. Backend `APP_ORIGIN`
o'rnatilgan bo'lsa undan foydalanadi; aks holda lokal manzil ishlatiladi.

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

## 4. Vercel frontend va FastAPI CORS

Render backendida `FRONTEND_ORIGIN` muhit o'zgaruvchisini
`https://ai-agent-firdavs25.vercel.app` qiymatiga sozlang. CORS middleware
Vercel origini bilan birga localhost 5507 originlarini ham ruxsat etadi.
`Origin` sarlavhasi bo'lmagan so'rovlar CORS tekshiruvini talab qilmaydi. `*` origin
credential cookie'lari bilan xavfsiz ishlatilmaydi, shuning uchun wildcard
allowlistga qo'shilmaydi; haqiqiy frontend domenini aniq yozing.

Vercel loyihasida **Settings -> Environment Variables** bo'limida quyidagini
qo'shing va keyin yangi deploy bajaring:

```text
VITE_API_URL=https://ai-agent-1-d569.onrender.com
```

Frontenddagi API so'rovlari shu URL ostidagi `/api/...` yo'llariga boradi.
Vercel frontend fayllari (`/assets/*.js`, `/assets/*.css`, logotiplar) Vercel
domenidan yuklanadi; ular backend API URL'iga yuborilmasligi kerak. Backendning
statik yo'llari lokal monolit ishga tushirish uchun qoladi; Vercel build
aktivlariga xizmat qilmaydi. Mahalliy `npm run dev` `VITE_API_URL` belgilanmaganida
`http://127.0.0.1:5507` backendidan foydalanadi.

Render backend Environment Variables bo'limida quyidagilarni belgilang:

```text
APP_ORIGIN=https://ai-agent-1-d569.onrender.com
FRONTEND_ORIGIN=https://ai-agent-firdavs25.vercel.app
GOOGLE_REDIRECT_URI=https://ai-agent-1-d569.onrender.com/api/auth/google/callback
```

`APP_ORIGIN` HTTPS bo'lishi Render'dagi secure session cookie'ni yoqadi.
Vercel va Render originlari turli domenlarda bo'lgani uchun sessiya cookie'si
`SameSite=None; Secure` bilan yuboriladi. Google OAuth ishlatilsa, Google Cloud
Console'da yuqoridagi Render callback manzilini ham Authorized redirect URI
sifatida qo'shing.
