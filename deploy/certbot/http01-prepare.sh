#!/bin/bash
# Шаг 1 из 2: подготовка перехода api.pulsdev.net с ручного DNS-01 на автоматический HTTP-01 (webroot).
# Запуск: sudo /opt/server-panel/deploy/certbot/http01-prepare.sh
# Что делает: бэкап renewal-конфига; deploy-hook «перечитать nginx после продления»; тестовый файл в webroot;
# ufw: порт 80 из интернета (Let's Encrypt приходит с непубличных адресов, ограничить источник нельзя).
# Зеркало jetsetter на :80 остаётся закрытым: его default_server отвечает 403 всем, кроме LAN и VPN.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S); WR=/var/www/letsencrypt
mkdir -p "$BK"; chmod 700 "$BK"
cp -p /etc/letsencrypt/renewal/api.pulsdev.net.conf "$BK/certbot-api.pulsdev.net.conf.bak-$TS"
echo "бэкап: $BK/certbot-api.pulsdev.net.conf.bak-$TS"

install -o root -g root -m 755 /dev/stdin /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
# certbot: после успешного продления — проверить и перечитать конфиг nginx (он держит сертификат в памяти)
nginx -t && systemctl reload nginx
HOOK
echo "deploy-hook установлен: /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh"

install -d -o root -g root -m 755 "$WR/.well-known/acme-challenge"
echo "acme-preflight-ok" > "$WR/.well-known/acme-challenge/panel-preflight"
chmod 644 "$WR/.well-known/acme-challenge/panel-preflight"

ufw allow 80/tcp comment 'ACME http-01 (api.pulsdev.net)'
echo "== ufw, порт 80:"; ufw status | grep -E "^80(/tcp)?\s" || true

echo "== локальная проверка webroot через nginx (Host api.pulsdev.net):"
got=$(curl -s -m5 --resolve api.pulsdev.net:80:127.0.0.1 http://api.pulsdev.net/.well-known/acme-challenge/panel-preflight || true)
[[ "$got" == "acme-preflight-ok" ]] && echo "OK: nginx отдаёт файл" || { echo "!! nginx не отдал тестовый файл (получено: '$got')" >&2; exit 1; }
echo "== зеркало на :80 по IP (должно быть 403 не из LAN; здесь запрос локальный, поэтому 200 — это нормально):"
curl -s -o /dev/null -m5 -w "%{http_code}\n" http://127.0.0.1/ || true
echo
echo "Готово. Теперь на роутере: TCP 80 (внешний) → 192.168.31.112:80. Потом скажите мне — проверю снаружи."
