#!/bin/bash
# Обменник SFTPGo → hdd1tb: данные в /mnt/hdd1tb/sftpgo-data, /srv/exchange — символическая ссылка на них (путь для compose, панели,
# ссылки SFTPGo в шаре MacMini и nginx не меняется). Старая папка → /srv/exchange.old (не удаляется). Квоты SFTPGo не трогает.
# Запуск: sudo /opt/server-panel/deploy/exchange/move-to-hdd1tb.sh       Откат: sudo /opt/server-panel/deploy/exchange/rollback-hdd1tb.sh
# Диски не отмонтируются и не форматируются; qBittorrent и торренты не затрагиваются.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
DISK=/mnt/hdd1tb; DATA=$DISK/sftpgo-data; LINK=/srv/exchange; OLD=/srv/exchange.old
COMPOSE=/opt/sftpgo/compose.yaml; GUARD=/home/hawk/Scripts/sftpgo-guard.sh
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)

echo "== 1. Проверки"
mountpoint -q "$DISK" || { echo "ОТКАЗ: $DISK не смонтирован" >&2; exit 1; }
[[ "$(mountpoint -d "$DISK")" != "$(mountpoint -d /)" ]] || { echo "ОТКАЗ: $DISK на системном диске" >&2; exit 1; }
[[ ! -L "$LINK" ]] || { echo "ОТКАЗ: $LINK уже ссылка ($(readlink "$LINK")) — перенос уже сделан" >&2; exit 1; }
[[ -d "$LINK" ]] || { echo "ОТКАЗ: нет каталога $LINK" >&2; exit 1; }
[[ ! -e "$OLD" ]] || { echo "ОТКАЗ: $OLD уже существует — переименуйте или удалите вручную" >&2; exit 1; }
n=$(find "$LINK" -type f | wc -l)
[[ "$n" -eq 0 ]] || { echo "ОТКАЗ: в обменнике $n файл(ов): нужен rsync, этот скрипт переносит только пустой обменник" >&2; exit 1; }
grep -q "create_host_path: false" "$DIR/compose.yaml" || { echo "ОТКАЗ: в compose.yaml нет create_host_path: false" >&2; exit 1; }
bash -n "$DIR/sftpgo-guard.sh"
free=$(df --output=avail -BG "$DISK" | tail -1 | tr -dc 0-9); echo "   диск смонтирован, свободно ${free} ГБ; обменник пуст"

echo "== 2. Резервные копии"
mkdir -p "$BK"; chmod 700 "$BK"
cp -p "$COMPOSE" "$BK/sftpgo-compose-before-hdd-$TS.yaml"; echo "   $BK/sftpgo-compose-before-hdd-$TS.yaml"
crontab -u hawk -l > "$BK/crontab-hawk-before-sftpgo-guard-$TS" 2>/dev/null || true; echo "   $BK/crontab-hawk-before-sftpgo-guard-$TS"

echo "== 3. Остановка SFTPGo"
docker compose -f "$COMPOSE" stop sftpgo

echo "== 4. Каталог данных на диске и права (рекурсивно и как default)"
install -d -o hawk -g hawk -m 750 "$DATA" "$DATA/uploads"
setfacl -R -m   u:macmini:rwX,u:hawk:rwX,u:panel:rX "$DATA"
setfacl -R -d -m u:macmini:rwX,u:hawk:rwX,u:panel:rX "$DATA"
getfacl -p "$DATA" | sed 's/^/   /'

echo "== 5. Переключение: /srv/exchange → $DATA"
mv "$LINK" "$OLD"
ln -s "$DATA" "$LINK"
ls -ld "$LINK" "$OLD" | sed 's/^/   /'

echo "== 6. Compose (долгий синтаксис, create_host_path: false) и запуск"
install -o root -g hawk -m 640 "$DIR/compose.yaml" "$COMPOSE"
docker compose -f "$COMPOSE" up -d

echo "== 7. Сторож (cron hawk, раз в минуту)"
install -d -o hawk -g hawk -m 755 /home/hawk/Scripts
install -o hawk -g hawk -m 755 "$DIR/sftpgo-guard.sh" "$GUARD"
( crontab -u hawk -l 2>/dev/null | grep -v "sftpgo-guard.sh" || true; echo "* * * * * $GUARD" ) | crontab -u hawk -
crontab -u hawk -l | grep -c sftpgo-guard | sed 's/^/   строк сторожа в cron hawk: /'

echo "== 8. Итог"
sleep 3; "$DIR/verify-hdd1tb.sh" || true
echo "Откат: sudo $DIR/rollback-hdd1tb.sh"
