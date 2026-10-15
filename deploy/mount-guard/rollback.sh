#!/bin/bash
# Откат mount-guard. Запуск: sudo /opt/server-panel/deploy/mount-guard/rollback.sh
# Выключает и удаляет юнит и скрипт. Лог /var/log/mount-guard.log и /etc/mount-guard.conf остаются (удалить: sudo rm …).
# Уже смонтированные тома не трогает.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
systemctl disable --now mount-guard.service 2>/dev/null || true
rm -f /etc/systemd/system/mount-guard.service /usr/local/sbin/mount-guard.sh /etc/logrotate.d/mount-guard /etc/sudoers.d/disk-monitor-hdd1tb
systemctl daemon-reload
systemctl reset-failed mount-guard.service 2>/dev/null || true
echo "mount-guard удалён. Оставлены: /etc/mount-guard.conf, /var/log/mount-guard.log, бэкапы *.bak-* (если были)."
