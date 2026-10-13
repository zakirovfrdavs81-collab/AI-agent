#!/bin/bash
# ==============================================================================
# Navo AI - Let's Encrypt (Certbot) SSL O'rnatish Skripti
# Ishga tushirishdan oldin domeningiz DNS sozlamalarida VPS IP manzilingizga
# to'g'ri yo'naltirilganligiga (A record) ishonch hosil qiling!
# ==============================================================================

set -e

DOMAIN="yourdomain.com"
EMAIL="admin@yourdomain.com"

echo "=== 1. Certbot va Nginx plaginini tekshirish/o'rnatish ==="
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

echo "=== 2. SSL Sertifikat olish ==="
# Nginx avtomatik ravishda sertifikatni oladi va /etc/nginx/sites-available ga ulaydi
sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "=== 3. Nginx konfiguratsiyasini qayta yuklash ==="
sudo nginx -t && sudo systemctl reload nginx

echo "=== 4. Sertifikatning avtomatik yangilanishini tekshirish ==="
sudo certbot renew --dry-run

echo "=== Muvaffaqiyatli yakunlandi! HTTPS faollashtirildi: https://$DOMAIN ==="
