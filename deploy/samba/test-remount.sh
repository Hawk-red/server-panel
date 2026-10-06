#!/bin/bash
# ДОКАЗАТЕЛЬСТВО выбора «ссылки вместо bind»: временный loop-образ, bind-монтирование и символическая ссылка на него,
# затем «перемонтирование» (umount -l + новый образ на тот же путь). Реальные диски НЕ трогаются.
# Запуск: sudo /opt/server-panel/deploy/samba/test-remount.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
W=$(mktemp -d /tmp/remount-test.XXXX); MP=$W/mnt; mkdir -p $MP $W/view
trap 'umount -l $W/view/bind 2>/dev/null || true; umount -l $MP 2>/dev/null || true; losetup -j $W/a.img -O NAME -n 2>/dev/null | xargs -r losetup -d; losetup -j $W/b.img -O NAME -n 2>/dev/null | xargs -r losetup -d; rm -rf "$W"' EXIT
mk() { truncate -s 64M $W/$1.img; mkfs.ext4 -q $W/$1.img; mount -o loop $W/$1.img $MP; echo "содержимое диска $1" > $MP/marker.txt; umount $MP; }
mk a; mk b
mount -o loop $W/a.img $MP
mkdir $W/view/bind; mount --bind $MP $W/view/bind; ln -s $MP $W/view/link
echo "до перемонтирования:  bind → $(cat $W/view/bind/marker.txt) | ссылка → $(cat $W/view/link/marker.txt)"
umount -l $MP; mount -o loop $W/b.img $MP        # «диск отвалился и вернулся»
echo "после перемонтирования: bind → $(cat $W/view/bind/marker.txt 2>&1 | head -1) | ссылка → $(cat $W/view/link/marker.txt)"
echo "(bind держит СТАРУЮ файловую систему, ссылка видит то, что смонтировано сейчас)"
