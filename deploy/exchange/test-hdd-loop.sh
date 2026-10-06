#!/bin/bash
# Доказательство на ВРЕМЕННОМ loop-образе (реальные диски и /srv/exchange не затрагиваются, qBittorrent не трогается):
#  1. контейнер с долгим синтаксисом (create_host_path: false) НЕ стартует, пока «диск» не смонтирован;
#  2. после «перемонтирования под новым номером» контейнер остаётся на старой файловой системе, сторож это находит и перезапускает его;
#  3. «диск» исчез — сторож останавливает контейнер.
# Запуск: sudo /opt/server-panel/deploy/exchange/test-hdd-loop.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; GUARD="$DIR/sftpgo-guard.sh"
IMG=lscr.io/linuxserver/socket-proxy:latest      # любой образ с sleep; боевой sftpgo не используется
W=$(mktemp -d /tmp/hdd-loop-test.XXXX); NAME=hddloop-test
cleanup() { docker rm -f $NAME >/dev/null 2>&1 || true; umount -l "$W/disk" 2>/dev/null || true; for i in a b; do losetup -j "$W/$i.img" -O NAME -n 2>/dev/null | xargs -r losetup -d; done; rm -rf "$W"; }
trap cleanup EXIT
mkdir -p "$W/disk"; for i in a b; do truncate -s 64M "$W/$i.img"; mkfs.ext4 -q "$W/$i.img"; done
export GUARD_CONTAINER=$NAME GUARD_DISK=$W/disk GUARD_LINK=$W/exchange GUARD_LOG=$W/guard.log GUARD_FLAG=$W/flag GUARD_LAST=$W/last GUARD_LOCK=$W/lock GUARD_DEST=/data/exchange
ln -s "$W/disk/sftpgo-data" "$W/exchange"
run() { docker run -d --name $NAME --pull never --entrypoint sleep --mount "type=bind,source=$W/exchange,target=/data/exchange,bind-propagation=rprivate" $IMG 3600 2>&1; }
st() { docker inspect -f '{{.State.Status}}' $NAME 2>/dev/null || echo "нет"; }
guard() { rm -f "$W/last"; bash "$GUARD"; tail -n1 "$W/guard.log" 2>/dev/null | cut -c21- | sed 's/^/     сторож: /'; }

echo "1. «диск» не смонтирован (ссылка в никуда): контейнер не должен стартовать"
out=$(run || true); if grep -q "bind source path does not exist" <<<"$out"; then echo "   ✓ отказ: bind source path does not exist"; else echo "   ✗ контейнер запустился!"; exit 1; fi
echo "2. «диск» A смонтирован: контейнер стартует и пишет на него"
mount -o loop "$W/a.img" "$W/disk"; mkdir "$W/disk/sftpgo-data"; run >/dev/null
docker exec $NAME sh -c 'echo A > /data/exchange/who'; echo "   контейнер видит: $(docker exec $NAME cat /data/exchange/who); сторож:"; guard
echo "3. «перемонтирование под новым номером»: umount -l + образ B на тот же путь"
umount -l "$W/disk"; mount -o loop "$W/b.img" "$W/disk"; mkdir "$W/disk/sftpgo-data"; echo B > "$W/disk/sftpgo-data/who"
echo "   контейнер ещё видит: $(docker exec $NAME cat /data/exchange/who) (старая файловая система), хост видит: $(cat "$W/disk/sftpgo-data/who")"
guard; sleep 2; echo "   после сторожа контейнер видит: $(docker exec $NAME cat /data/exchange/who)"
[[ "$(docker exec $NAME cat /data/exchange/who)" == B ]] && echo "   ✓ перезапущен на новом диске" || { echo "   ✗ остался на старом"; exit 1; }
echo "4. «диск» исчез: контейнер должен остановиться"
umount -l "$W/disk"; guard; echo "   статус: $(st)"; [[ "$(st)" == exited ]] && echo "   ✓ остановлен" || exit 1
echo "5. диск вернулся: сторож запускает контейнер"
mount -o loop "$W/b.img" "$W/disk"; guard; sleep 1; echo "   статус: $(st)"; [[ "$(st)" == running ]] && echo "   ✓ запущен"
echo "Готово: временные образы и контейнер удаляются."
