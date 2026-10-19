#!/bin/bash
# Откат установки помощника Bluetooth: удаляет помощник, sudoers и logrotate. Журнал /var/log/server-panel-bluetooth.log остаётся.
# Состояние Bluetooth не трогает (если включали тумблером — остаётся как есть; вернуть «как было»: см. README, раздел «Вернуть masked»).
# Запуск: sudo /opt/server-panel/deploy/bluetooth/rollback.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
rm -fv /etc/sudoers.d/server-panel-bluetooth /usr/local/sbin/server-panel-bluetooth /etc/logrotate.d/server-panel-bluetooth
visudo -c >/dev/null && echo "sudoers в порядке"
echo "Готово. Панель покажет плашку «хелпер не установлен» (после sudo systemctl restart server-panel — не обязательно)."
