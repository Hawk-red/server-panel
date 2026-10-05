#!/bin/bash
# fail2ban для панели: фильтр panel-auth и jail по /var/log/nginx/panel.access.log.
# Запуск: sudo /opt/server-panel/deploy/panel-https/install-fail2ban.sh
# Если fail2ban не установлен: sudo apt install fail2ban (на этом сервере он уже стоит и охраняет sshd и обменник).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)/fail2ban"
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
command -v fail2ban-client >/dev/null || { echo "fail2ban не установлен: sudo apt install fail2ban" >&2; exit 1; }
mkdir -p "$BK"; chmod 700 "$BK"
tar czf "$BK/fail2ban-etc-$TS.tgz" -C /etc fail2ban
echo "резервная копия: $BK/fail2ban-etc-$TS.tgz"

# Лог должен существовать (создаётся nginx при первом запросе к хосту) — иначе fail2ban не запустит jail
[[ -f /var/log/nginx/panel.access.log ]] || { install -o root -g adm -m 640 /dev/null /var/log/nginx/panel.access.log; echo "создан пустой /var/log/nginx/panel.access.log"; }

# Проверка фильтра на образцах: две неудачи входа должны сработать, остальное — нет
SAMPLE=$(mktemp)
cat > "$SAMPLE" <<'LOG'
203.0.113.5 - - [06/Oct/2026:10:00:01 +0300] "POST /api/auth/login HTTP/2.0" 401 41 "-" "curl/8"
203.0.113.5 - - [06/Oct/2026:10:00:02 +0300] "POST /api/auth/login HTTP/2.0" 429 60 "-" "curl/8"
203.0.113.5 - - [06/Oct/2026:10:00:03 +0300] "GET /api/auth/me HTTP/2.0" 401 41 "-" "Mozilla"
203.0.113.5 - - [06/Oct/2026:10:00:04 +0300] "POST /api/auth/login HTTP/2.0" 200 11 "-" "Mozilla"
203.0.113.5 - - [06/Oct/2026:10:00:05 +0300] "GET /index.html HTTP/2.0" 200 4121 "-" "Mozilla"
LOG
install -o root -g root -m 644 "$SRC/filter-panel.conf" /etc/fail2ban/filter.d/panel-auth.conf
OUT=$(fail2ban-regex "$SAMPLE" /etc/fail2ban/filter.d/panel-auth.conf 2>&1 || true); rm -f "$SAMPLE"
echo "$OUT" | grep -E "Lines:|failregex" | head -3
echo "$OUT" | grep -q "Lines: 5 lines, 0 ignored, 2 matched" || { echo "Фильтр сработал не так, как ожидалось — установка остановлена" >&2; exit 1; }

install -o root -g root -m 644 "$SRC/jail-panel.local" /etc/fail2ban/jail.d/panel-auth.local
fail2ban-client -t >/dev/null
fail2ban-client reload
sleep 2
fail2ban-client status panel-auth | head -6
echo "Готово. Снять бан: sudo fail2ban-client set panel-auth unbanip <IP>. Откат: sudo rm /etc/fail2ban/jail.d/panel-auth.local /etc/fail2ban/filter.d/panel-auth.conf && sudo fail2ban-client reload"
