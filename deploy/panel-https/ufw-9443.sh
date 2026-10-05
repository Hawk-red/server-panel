#!/bin/bash
# Порт 9443 для панели ДОМА и по WireGuard: правила ufw только для 192.168.31.0/24 и 10.10.10.0/24 (из интернета на сам 9443
# никто не заходит: роутер пробрасывает внешний 9443 на порт 443 сервера, он уже открыт). Идемпотентно: повторный запуск ничего не дублирует.
# Запуск: sudo /opt/server-panel/deploy/panel-https/ufw-9443.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"; chmod 700 "$BK"
ufw status numbered > "$BK/ufw-status-before-9443-$TS.txt"
echo "состояние ufw до изменений: $BK/ufw-status-before-9443-$TS.txt"
add() { # источник
  if ufw status | grep -E "9443/tcp +ALLOW +$1" >/dev/null; then echo "уже есть: $1 → 9443/tcp"
  else ufw allow from "$1" to any port 9443 proto tcp comment 'panel https'; fi
}
add 192.168.31.0/24
add 10.10.10.0/24
ufw status | grep -E "9443|Status"
