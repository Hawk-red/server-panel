#!/bin/bash
# Шаг 2 из 2: перевод продления на webroot (HTTP-01) и проверка. Запускать ТОЛЬКО после проброса 80→112:80 и внешней проверки.
# Запуск: sudo /opt/server-panel/deploy/certbot/http01-switch.sh
# `certbot reconfigure` сам делает пробный прогон (dry-run, боевой сертификат не трогает) и сохраняет настройки только при успехе.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
CONF=/etc/letsencrypt/renewal/api.pulsdev.net.conf
rm -f /var/www/letsencrypt/.well-known/acme-challenge/panel-preflight

certbot reconfigure --cert-name api.pulsdev.net --webroot -w /var/www/letsencrypt --preferred-challenges http --run-deploy-hooks

# Старая строка ручного хука после смены плагина не нужна
if grep -q '^manual_auth_hook' "$CONF"; then sed -i '/^manual_auth_hook/d' "$CONF"; echo "убрана строка manual_auth_hook из $CONF"; fi

echo "== отдельный пробный прогон продления (staging Let's Encrypt):"
certbot renew --cert-name api.pulsdev.net --dry-run

echo "== итоговые настройки:"
grep -E '^(authenticator|webroot_path|pref_challs|key_type)|^api.pulsdev.net|^\[\[webroot_map' "$CONF" || true
certbot certificates 2>/dev/null | sed -n '/Certificate Name: api.pulsdev.net/,/Certificate Path/p'
systemctl list-timers certbot.timer --no-pager | head -3
