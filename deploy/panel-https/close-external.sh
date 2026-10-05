#!/bin/bash
# ЗАКРЫТЬ панель от интернета: вернуть nginx-вариант с `deny all` (только LAN, WireGuard, localhost).
# Запуск: sudo /opt/server-panel/deploy/panel-https/close-external.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
CLOSED="$DIR/panel.pulsdev.net.conf"
SITE=/etc/nginx/sites-available/panel.pulsdev.net
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
[[ -f "$CLOSED" ]] || { echo "Нет $CLOSED" >&2; exit 1; }
mkdir -p "$BK"; chmod 700 "$BK"
[[ -f "$SITE" ]] && cp -p "$SITE" "$BK/panel.pulsdev.net.site-before-close-$TS"
install -o root -g root -m 644 "$CLOSED" "$SITE"
if ! nginx -t; then
  echo "nginx -t не прошёл — возвращаю прежний файл" >&2
  [[ -f "$BK/panel.pulsdev.net.site-before-close-$TS" ]] && cp -p "$BK/panel.pulsdev.net.site-before-close-$TS" "$SITE"
  exit 1
fi
systemctl reload nginx
echo "Готово: nginx снова отвечает 403 всем, кроме 192.168.31.0/24, 10.10.10.0/24 и 127.0.0.1."
curl -sk -o /dev/null -w "проверка с сервера, порт 443:  HTTP %{http_code} (ожидается 200 — запрос с 127.0.0.1)\n" --resolve panel.pulsdev.net:443:127.0.0.1 https://panel.pulsdev.net/
ss -ltn | grep -q ":9443 " && curl -sk -o /dev/null -w "проверка с сервера, порт 9443: HTTP %{http_code}\n" --resolve panel.pulsdev.net:9443:127.0.0.1 https://panel.pulsdev.net:9443/
echo "Рекомендуется также выключить «Доступ из интернета» в разделе «Безопасность» панели (завершит внешние сессии)."
