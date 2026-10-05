#!/bin/bash
# Панель по HTTPS на panel.pulsdev.net: сертификат (DNS-01 нашим хуком) + виртуальный хост nginx.
# Запуск: sudo /opt/server-panel/deploy/panel-https/install.sh
# Порядок безопасный: сначала сертификат, затем резервная копия, потом конфиг; nginx перезагружается только после `nginx -t`.
# Существующие хосты (api.pulsdev.net, SFTPGo, jetsetter) и их сертификаты не меняются.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DOMAIN=panel.pulsdev.net
HOOK=/usr/local/sbin/admtools-dns-hook.py
SRC="$(cd "$(dirname "$0")" && pwd)/panel.pulsdev.net.conf"
SITE=/etc/nginx/sites-available/$DOMAIN
LINK=/etc/nginx/sites-enabled/$DOMAIN
BK=/root/backup-configs
TS=$(date +%Y%m%d-%H%M%S)
[[ -x "$HOOK" ]] || { echo "Нет хука $HOOK" >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "Нет файла $SRC" >&2; exit 1; }
mkdir -p "$BK"; chmod 700 "$BK"

echo "== 1. Резервная копия nginx и certbot"
tar czf "$BK/nginx-etc-$TS.tgz" -C /etc nginx
tar czf "$BK/letsencrypt-renewal-$TS.tgz" -C /etc/letsencrypt renewal
echo "   $BK/nginx-etc-$TS.tgz, $BK/letsencrypt-renewal-$TS.tgz"

echo "== 2. Сертификат $DOMAIN (DNS-01, отдельный от api.pulsdev.net)"
if [[ -d /etc/letsencrypt/live/$DOMAIN ]]; then
  echo "   уже есть, пропускаю"
else
  certbot certonly --non-interactive --manual --preferred-challenges dns \
    --manual-auth-hook "$HOOK auth" --manual-cleanup-hook "$HOOK cleanup" \
    --key-type ecdsa -d "$DOMAIN"
fi
# deploy-hook общий для всех сертификатов (перечитать nginx после продления)
if [[ ! -x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh ]]; then
  install -o root -g root -m 755 /dev/stdin /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
nginx -t && systemctl reload nginx
HOOK
fi

echo "== 3. Виртуальный хост nginx"
install -o root -g root -m 644 "$SRC" "$SITE"
ln -sfn "$SITE" "$LINK"
if ! nginx -t; then
  echo "nginx -t не прошёл — откатываю: убираю ссылку, nginx не перезагружался" >&2
  rm -f "$LINK"
  exit 1
fi
systemctl reload nginx
echo "   nginx перезагружен"

echo "== 4. Проверка продления (dry-run для всех сертификатов)"
certbot renew --dry-run

echo "== 5. Готово"
echo "Дальше: /opt/server-panel/deploy/panel-https/verify.sh"
echo "Откат: sudo rm $LINK && sudo nginx -t && sudo systemctl reload nginx"
