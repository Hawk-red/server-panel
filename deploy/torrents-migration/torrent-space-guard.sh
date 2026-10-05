#!/bin/bash
# Pause/resume qbittorrent torrents based on free space where downloads actually go.
# С 05.10.2026 закачки идут на hdd1tb (/mnt/hdd1tb/qbittorrent-downloads, в контейнере /downloads-hdd).
# Корневой SSD (/home/torrents-tmp) больше не используется для закачек; это папка для отката.
# qBittorrent 5.x: torrents/pause|resume переименованы в torrents/stop|start (старые отдают 404).

QB_URL="http://localhost:8090"
QB_USER="admin"
QB_PASS_FILE="/home/hawk/scripts/.qb_credentials"
DOWNLOAD_DIR="/mnt/hdd1tb"
# Флаг «паузу поставил этот скрипт»: без него «продолжить все» запускал бы и вручную остановленные торренты
PAUSED_FLAG="/home/hawk/scripts/.space-guard-paused"
LOW_GB=50
RESUME_GB=100
COOKIE=$(mktemp)

source "$QB_PASS_FILE"

curl -s -c "$COOKIE" -d "username=${QB_USER}&password=${QB_PASS}" "$QB_URL/api/v2/auth/login" > /dev/null

# Диск должен быть смонтирован: иначе df покажет корень, и защита будет смотреть не туда
if ! mountpoint -q "$DOWNLOAD_DIR"; then
    if [ ! -f "$PAUSED_FLAG" ]; then
        curl -s -b "$COOKIE" -X POST "$QB_URL/api/v2/torrents/stop" --data-urlencode "hashes=all" > /dev/null
        touch "$PAUSED_FLAG"
        echo "$(date '+%Y-%m-%d %H:%M:%S') DISK NOT MOUNTED: $DOWNLOAD_DIR - torrents paused" >> /var/log/torrent-move.log
    fi
    rm -f "$COOKIE"
    exit 0
fi

avail_kb=$(df --output=avail "$DOWNLOAD_DIR" | tail -1)
avail_gb=$((avail_kb / 1024 / 1024))

if [ "$avail_gb" -lt "$LOW_GB" ]; then
    if [ ! -f "$PAUSED_FLAG" ]; then
        curl -s -b "$COOKIE" -X POST "$QB_URL/api/v2/torrents/stop" --data-urlencode "hashes=all" > /dev/null
        touch "$PAUSED_FLAG"
        echo "$(date '+%Y-%m-%d %H:%M:%S') LOW SPACE (${avail_gb}G < ${LOW_GB}G) on $DOWNLOAD_DIR - torrents paused" >> /var/log/torrent-move.log
    fi
elif [ "$avail_gb" -ge "$RESUME_GB" ] && [ -f "$PAUSED_FLAG" ]; then
    curl -s -b "$COOKIE" -X POST "$QB_URL/api/v2/torrents/start" --data-urlencode "hashes=all" > /dev/null
    rm -f "$PAUSED_FLAG"
    echo "$(date '+%Y-%m-%d %H:%M:%S') SPACE OK (${avail_gb}G >= ${RESUME_GB}G) on $DOWNLOAD_DIR - torrents resumed" >> /var/log/torrent-move.log
fi

rm -f "$COOKIE"
