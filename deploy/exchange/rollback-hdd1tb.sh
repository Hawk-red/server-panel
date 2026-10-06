#!/bin/bash
# Откат: SFTPGo снова на локальной папке /srv/exchange (SSD). Данные на hdd1tb не удаляются. Если за время работы на диске в обменник что-то
# загрузили, скрипт сначала копирует это в старую папку (rsync -a), без удаления чего-либо.
# Запуск: sudo /opt/server-panel/deploy/exchange/rollback-hdd1tb.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DATA=/mnt/hdd1tb/sftpgo-data; LINK=/srv/exchange; OLD=/srv/exchange.old; COMPOSE=/opt/sftpgo/compose.yaml
[[ -L "$LINK" && -d "$OLD" ]] || { echo "ОТКАЗ: $LINK не ссылка или нет $OLD — откатывать нечего" >&2; exit 1; }
PREV=$(ls -1t /root/backup-configs/sftpgo-compose-before-hdd-*.yaml 2>/dev/null | head -1 || true)
[[ -n "$PREV" ]] || { echo "ОТКАЗ: нет резервной копии compose в /root/backup-configs" >&2; exit 1; }
echo "== Остановка SFTPGo"; docker compose -f "$COMPOSE" stop sftpgo
if mountpoint -q /mnt/hdd1tb && [[ -d "$DATA" ]] && [[ -n "$(find "$DATA" -type f -print -quit)" ]]; then
  echo "== На диске есть загруженные файлы — копирую в $OLD (rsync -a)"; rsync -a "$DATA/" "$OLD/"
fi
echo "== Возврат папки и compose"
rm "$LINK"; mv "$OLD" "$LINK"; install -o root -g hawk -m 640 "$PREV" "$COMPOSE"
echo "== Сторож выключается (строка в cron hawk удаляется)"
( crontab -u hawk -l 2>/dev/null | grep -v "sftpgo-guard.sh" || true ) | crontab -u hawk -
docker compose -f "$COMPOSE" up -d
sleep 2; docker ps --filter name=sftpgo --format '   {{.Names}}: {{.Status}}'; ls -ld "$LINK" | sed 's/^/   /'
echo "Данные на hdd1tb остались в $DATA (удалять вручную, когда будете уверены)."
