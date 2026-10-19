#!/bin/bash
# Установка root-помощника Bluetooth и его sudoers (карточка Bluetooth в разделе «Беспроводные»).
# Запуск: sudo /opt/server-panel/deploy/bluetooth/install.sh
# Порядок: проверки → visudo -cf ДО установки → резервные копии → установка → итоговая проверка.
# Состояние Bluetooth (masked / остановлен) НЕ меняется: помощник только устанавливается.
# Откат: sudo /opt/server-panel/deploy/bluetooth/rollback.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_SRC="$DIR/server-panel-bluetooth"; SUDOERS_SRC="$DIR/sudoers-server-panel-bluetooth"
HELPER=/usr/local/sbin/server-panel-bluetooth; SUDOERS=/etc/sudoers.d/server-panel-bluetooth
LOG=/var/log/server-panel-bluetooth.log; LOGROTATE=/etc/logrotate.d/server-panel-bluetooth
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
[[ -f "$HELPER_SRC" && -f "$SUDOERS_SRC" ]] || { echo "Нет исходников в $DIR" >&2; exit 1; }

echo "== 1. Проверки до установки"
python3 -I -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$HELPER_SRC" && echo "   синтаксис помощника: ok"
python3 -I "$DIR/test_helper.py" 2>&1 | tail -1 | sed 's/^/   тесты помощника: /'
visudo -cf "$SUDOERS_SRC"
grep -q "SP_BTHELPER" "$SUDOERS_SRC" || { echo "В sudoers нет SP_BTHELPER" >&2; exit 1; }
getent passwd panel >/dev/null || { echo "Нет пользователя panel" >&2; exit 1; }
[[ -x /usr/bin/systemctl && -x /usr/sbin/rfkill ]] || { echo "Нет systemctl или rfkill" >&2; exit 1; }

echo "== 2. Резервные копии"
mkdir -p "$BK"; chmod 700 "$BK"
[[ -f "$HELPER" ]] && cp -p "$HELPER" "$BK/server-panel-bluetooth-before-$TS" && echo "   $BK/server-panel-bluetooth-before-$TS"
[[ -f "$SUDOERS" ]] && cp -p "$SUDOERS" "$BK/sudoers-server-panel-bluetooth-before-$TS" && echo "   $BK/sudoers-server-panel-bluetooth-before-$TS"

echo "== 3. Установка"
install -o root -g root -m 755 "$HELPER_SRC" "$HELPER"
install -o root -g root -m 440 "$SUDOERS_SRC" "$SUDOERS"
if ! visudo -c >/dev/null; then
  echo "Итоговая проверка sudoers не прошла — убираю новый файл" >&2
  if [[ -f "$BK/sudoers-server-panel-bluetooth-before-$TS" ]]; then install -o root -g root -m 440 "$BK/sudoers-server-panel-bluetooth-before-$TS" "$SUDOERS"; else rm -f "$SUDOERS"; fi
  exit 1
fi
[[ -f "$LOG" ]] || install -o root -g adm -m 640 /dev/null "$LOG"
cat > "$LOGROTATE" <<'LR'
/var/log/server-panel-bluetooth.log {
    monthly
    rotate 6
    compress
    missingok
    notifempty
    create 640 root adm
}
LR
cmp -s "$HELPER_SRC" "$HELPER" && cmp -s "$SUDOERS_SRC" "$SUDOERS" && echo "   установленные файлы совпадают с deploy/"

echo "== 4. Проверка от имени panel"
if sudo -u panel sudo -n "$HELPER" status; then echo "   status от panel: ok"; else echo "   ВНИМАНИЕ: panel не смогла вызвать status" >&2; fi
if sudo -u panel sudo -n "$HELPER" restart >/dev/null 2>&1; then echo "   ВНИМАНИЕ: лишняя команда разрешена!" >&2; else echo "   лишняя команда отклоняется: ok"; fi

echo
echo "Готово. Состояние Bluetooth не менялось. Чтобы панель увидела новые маршруты и тумблеры: sudo systemctl restart server-panel"
echo "Откат: sudo $DIR/rollback.sh"
