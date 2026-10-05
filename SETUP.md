# Gemini Chat'ni ishga tushirish

Bu paketda maxfiy kalitlar yo'q. Mijoz `.env.example` nusxasini `.env` qilib,
o'zining Gemini, SMS va Google credentiallarini kiritadi. `.env` faylini ZIP
orqali boshqa odamga yubormang.

## 1. Avtomatik ishga tushirish

Avval `run.bat` faylini ikki marta bosing. U FastAPI backendini `8000` portda
ishga tushiradi. So'ng loyiha papkasida terminal ochib `npm run dev` buyrug'ini
bajaring; Vite frontendni `5506` portda ochadi va `/api` so'rovlarini backendga
uzatadi.

```text
http://127.0.0.1:5506
```

VS Code Live Server (`Go Live`) o'rniga `npm run dev` ishlating: Vite React
fayllarini brauzer uchun tayyorlaydi. Kirish, SMS va Google OAuth so'rovlari
FastAPI backendida ishlaydi.

## 2. `.env` sozlash

`.env.example` faylidan `.env` nusxa oling va quyidagilarni to'ldiring:

```env
GEMINI_API_KEY=...
SESSION_SECRET=uzun-maxfiy-kalit
APP_ORIGIN=http://127.0.0.1:5506
ESKIZ_EMAIL=...
ESKIZ_PASSWORD=...
SMTP_USER=...
SMTP_PASSWORD=...
DEV_SHOW_OTP=true
OTP_MODE=auto
```

Telefon OTP uchun Eskiz akkaunti va SMS balansi kerak. Email OTP uchun Gmail App Password kerak.
Test uchun `DEV_SHOW_OTP=true` qoldiriladi: kod sahifada ko'rsatiladi. Haqiqiy
SMS uchun Eskiz ma'lumotlarini kiriting va `DEV_SHOW_OTP=false`, `OTP_MODE=live`
qiling. Shunda kod ekranda ko'rsatilmaydi.

## 3. Google orqali kirish

Google Cloud Console'da OAuth Client ID (Web application) yarating. Authorized redirect URI sifatida aynan quyidagini qo'shing:

```text
http://127.0.0.1:5506/api/auth/google/callback
```

`.env` ichiga yozing:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Keyin serverni qayta ishga tushiring. Google login faqat shu ikki credential va mos redirect URI bilan ishlaydi.
