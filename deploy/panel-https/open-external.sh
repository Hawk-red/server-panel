#!/bin/bash
# ОТКРЫТЬ панель для доступа из интернета (https://panel.pulsdev.net:9443): nginx без `deny all`, с лимитами.
# Запуск: sudo /opt/server-panel/deploy/panel-https/open-external.sh
# Перед запуском: (1) в «Безопасности» включена 2FA, (2) установлен fail2ban-jail (install-fail2ban.sh), (3) перезапущена панель с новым кодом.
# После запуска: в «Безопасности» включить «Доступ из интернета» (пока выключатель выключен, снаружи 403 даже при открытом nginx).
# При любой ошибке nginx -t или reload прежний конфиг возвращается автоматически. Вернуть закрытый вариант: close-external.sh.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
OPEN="$DIR/panel.pulsdev.net.open.conf"
SITE=/etc/nginx/sites-available/panel.pulsdev.net
LINK=/etc/nginx/sites-enabled/panel.pulsdev.net
DB=/opt/server-panel/data/panel.db
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
[[ -f "$OPEN" ]] || { echo "Нет $OPEN" >&2; exit 1; }
[[ -f "$SITE" && -L "$LINK" ]] || { echo "Хост panel.pulsdev.net ещё не установлен (install.sh)" >&2; exit 1; }
[[ -f /etc/letsencrypt/live/panel.pulsdev.net/fullchain.pem ]] || { echo "Нет сертификата panel.pulsdev.net" >&2; exit 1; }

echo "== Проверки перед открытием"
# 1. Новая версия панели запущена (знает про внешних клиентов)
curl -fsS --max-time 5 http://127.0.0.1:7575/api/auth/info | grep -q '"external"' \
  || { echo "ОТКАЗ: панель работает на старой версии — sudo systemctl restart server-panel" >&2; exit 1; }
echo "   панель: новая версия"
# 2. 2FA включена (читаем настройку из базы панели)
python3 - "$DB" <<'PY' || { echo "ОТКАЗ: двухфакторный вход не включён. Включите его в панели: «Безопасность»" >&2; exit 1; }
import json, sqlite3, sys
row = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True).execute("select value from settings where key='security.totp'").fetchone()
sys.exit(0 if row and json.loads(row[0] or "null") and json.loads(row[0])["enabled"] else 1)
PY
echo "   2FA: включена"
# 3. fail2ban-jail работает
fail2ban-client status panel-auth >/dev/null 2>&1 \
  || { echo "ОТКАЗ: нет jail panel-auth — sudo $DIR/install-fail2ban.sh (или ALLOW_NO_FAIL2BAN=1 для запуска без него)" >&2; [[ "${ALLOW_NO_FAIL2BAN:-}" == 1 ]] || exit 1; }
echo "   fail2ban: ok"

echo "== Переключение"
mkdir -p "$BK"; chmod 700 "$BK"
cp -p "$SITE" "$BK/panel.pulsdev.net.site-before-open-$TS"
echo "   резервная копия: $BK/panel.pulsdev.net.site-before-open-$TS"
install -o root -g root -m 644 "$OPEN" "$SITE"
if ! nginx -t; then
  echo "nginx -t не прошёл — возвращаю прежний конфиг, nginx не перезагружался" >&2
  cp -p "$BK/panel.pulsdev.net.site-before-open-$TS" "$SITE"
  exit 1
fi
if ! systemctl reload nginx; then
  echo "reload не удался — возвращаю прежний конфиг" >&2
  cp -p "$BK/panel.pulsdev.net.site-before-open-$TS" "$SITE"; nginx -t && systemctl reload nginx
  exit 1
fi
echo "   nginx перезагружен: хост открыт (лимиты включены)"
curl -sk -o /dev/null -w "   проверка с сервера: HTTP %{http_code}\n" --resolve panel.pulsdev.net:443:127.0.0.1 https://panel.pulsdev.net/
echo
echo "Дальше: «Безопасность» → «Доступ из интернета» → включить. Проверить с телефона (мобильный интернет): https://panel.pulsdev.net:9443"
echo "Закрыть обратно: sudo $DIR/close-external.sh   (и/или выключить выключатель в «Безопасности»)"
