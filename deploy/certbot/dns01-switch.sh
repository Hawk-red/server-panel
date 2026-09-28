#!/bin/bash
# Шаг 2: перевод продления api.pulsdev.net на автоматический DNS-01 через adm.tools (без порта 80).
# Запускать ТОЛЬКО после dns01-setup.sh (токен должен быть уже проверен селфтестом).
# Запуск: sudo /opt/server-panel/deploy/certbot/dns01-switch.sh
# `certbot reconfigure` сам делает пробный прогон (dry-run) и сохраняет новые настройки только при успехе —
# боевой сертификат он не трогает.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
HOOK=/usr/local/sbin/admtools-dns-hook.py
CONF=/etc/letsencrypt/renewal/api.pulsdev.net.conf
BK=/root/backup-configs
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"; chmod 700 "$BK"

[[ -x "$HOOK" ]] || { echo "Хук не установлен — сначала sudo $(dirname "$0")/dns01-setup.sh" >&2; exit 1; }
[[ -f /etc/letsencrypt/admtools-api-token ]] || { echo "Нет файла токена — сначала dns01-setup.sh" >&2; exit 1; }

cp -p "$CONF" "$BK/certbot-api.pulsdev.net.conf.bak-$TS"
echo "бэкап renewal-конфига: $BK/certbot-api.pulsdev.net.conf.bak-$TS"

# deploy-hook: после успешного продления перечитать nginx (сертификат он держит в памяти)
install -o root -g root -m 755 /dev/stdin /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
nginx -t && systemctl reload nginx
HOOK

certbot reconfigure --cert-name api.pulsdev.net \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$HOOK auth" \
  --manual-cleanup-hook "$HOOK cleanup" \
  --run-deploy-hooks --non-interactive

echo
echo "== итоговые настройки renewal:"
grep -E '^(authenticator|pref_challs|manual_auth_hook|manual_cleanup_hook)' "$CONF" || true

echo
echo "== отдельный пробный прогон продления (staging Let's Encrypt, боевой сертификат не трогает):"
certbot renew --cert-name api.pulsdev.net --dry-run

echo
echo "Готово. Следующий автоматический запуск:"
systemctl list-timers certbot.timer --no-pager | head -3
echo
echo "Проверить всё «от начала до конца» прямо сейчас (выпустит настоящий сертификат немного раньше срока):"
echo "  sudo certbot renew --cert-name api.pulsdev.net --force-renewal"
