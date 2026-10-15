#!/bin/bash
# Установка mount-guard. Запуск: sudo /opt/server-panel/deploy/mount-guard/install.sh
# Ничего не монтирует и не запускает сейчас: только копирует файлы и включает юнит на СЛЕДУЮЩУЮ загрузку.
# Чтобы запустить сторож сразу (он безопасен: смонтированное не трогает): sudo systemctl start mount-guard.service
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
SRC=/opt/server-panel/deploy/mount-guard
TS=$(date +%Y%m%d-%H%M%S)

bash -n "$SRC/mount-guard.sh"
install -d -m 755 /var/lib/mount-guard
for f in /usr/local/sbin/mount-guard.sh /etc/systemd/system/mount-guard.service; do
  [[ -e $f ]] && cp -a "$f" "$f.bak-$TS" && echo "бэкап: $f.bak-$TS"
done
install -o root -g root -m 755 "$SRC/mount-guard.sh" /usr/local/sbin/mount-guard.sh
install -o root -g root -m 644 "$SRC/mount-guard.service" /etc/systemd/system/mount-guard.service
# конфиг существующий не перезаписываем (там могли включить AUTO_START_CONTAINERS)
if [[ -e /etc/mount-guard.conf ]]; then echo "/etc/mount-guard.conf уже есть — не трогаю"
else install -o root -g root -m 644 "$SRC/mount-guard.conf.example" /etc/mount-guard.conf; fi
# лог: root пишет, панель (группа adm) читает — из него детектор панели берёт события для Telegram
if [[ ! -e /var/log/mount-guard.log ]]; then install -o root -g adm -m 640 /dev/null /var/log/mount-guard.log; fi
install -o root -g root -m 644 "$SRC/mount-guard.logrotate" /etc/logrotate.d/mount-guard

# sudo-правило для disk-monitor.sh: ровно одна команда «mount /mnt/hdd1tb» (проверяется visudo перед установкой)
visudo -cf "$SRC/sudoers-disk-monitor-hdd1tb" >/dev/null
install -o root -g root -m 440 "$SRC/sudoers-disk-monitor-hdd1tb" /etc/sudoers.d/disk-monitor-hdd1tb
visudo -c >/dev/null

systemd-analyze verify /etc/systemd/system/mount-guard.service
systemctl daemon-reload
systemctl enable mount-guard.service
echo
echo "Готово. Проверка:  systemctl is-enabled mount-guard.service ; sudo DRY_RUN=1 /usr/local/sbin/mount-guard.sh"
echo "Уведомления в Telegram заработают после пересборки и перезапуска панели (см. README, шаг 2)."
