# ==============================================================================
# Navo AI - Ko'p bosqichli Dockerfile (Multi-stage build)
# 1-bosqich: Frontend build (Node.js)
# 2-bosqich: Backend runtime (Python 3.12)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1-Bosqich: Frontend build
# ------------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Bog'liqliklar keshi
COPY package.json package-lock.json ./
RUN npm ci || npm install

# Frontend manbalarini nusxalash va yig'ish (dist yaratish)
COPY frontend ./frontend
RUN npm run build

# ------------------------------------------------------------------------------
# 2-Bosqich: Python backend va ishlab chiqarish runtime
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS runner
WORKDIR /app

# Healthcheck uchun curl va minimal tizim vositalarini o'rnatish
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python bog'liqliklarini o'rnatish
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r backend/requirements.txt

# Backend, showcase va statik resurslarni nusxalash
COPY backend ./backend
COPY showcase ./showcase
COPY frontend/css ./frontend/css
COPY frontend/js ./frontend/js
COPY frontend/showcase ./frontend/showcase
COPY frontend/public ./frontend/public

# 1-bosqichda yig'ilgan frontend build natijasini nusxalash
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# SQLite ma'lumotlar bazasi saqlanishi uchun data papkasi
RUN mkdir -p /app/backend/data

# Standart muhit o'zgaruvchilari
ENV HOST=0.0.0.0 \
    PORT=5507 \
    ENVIRONMENT=production \
    PYTHONPATH=/app \
    FORWARDED_ALLOW_IPS=*

EXPOSE 5507

# Healthcheck Render bergan PORT va ilovaning health endpointidan foydalanadi.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:${PORT}/api/health || exit 1

# Uvicorn serverini reverse proxy va xavfsizlik sozlamalari bilan ishga tushirish
CMD ["sh", "-c", "uvicorn backend.main:app --host ${HOST} --port ${PORT} --proxy-headers"]
