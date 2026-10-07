#!/bin/bash
# Свободное место в Finder для шары MacMini: dfree command → /usr/local/sbin/smb-dfree.sh (корень шары = df /mnt/hdd1tb). Копия smb.conf, testparm, reload (НЕ restart). Диски и торренты не трогает.
# Запуск: sudo /opt/server-panel/deploy/samba/apply-dfree.sh        Откат: sudo /opt/server-panel/deploy/samba/rollback-dfree.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; LIVE=/etc/samba/smb.conf; SCRIPT=/usr/local/sbin/smb-dfree.sh
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"; chmod 700 "$BK"
grep -q '^\[MacMini\]' "$LIVE" || { echo "В $LIVE нет секции [MacMini]" >&2; exit 1; }
grep -qE '^\s*dfree command' "$LIVE" && { echo "dfree command уже задан — ничего не меняю" >&2; exit 1; }
echo "== 1. Свободное место на / (запись не должна упасть)"; df -h / | tail -1
[[ $(df --output=avail -k / | tail -1) -gt 5120 ]] || { echo "На / меньше 5 МБ — сначала освободите место" >&2; exit 1; }
echo "== 2. Резервная копия"; cp -p "$LIVE" "$BK/smb.conf.before-dfree-$TS"; cp -p "$LIVE" "$LIVE.bak-before-dfree-$TS"; echo "   $BK/smb.conf.before-dfree-$TS"
echo "== 3. Скрипт и проверка"; install -o root -g root -m 755 "$DIR/smb-dfree.sh" "$SCRIPT"
for p in /srv/share /srv/share/1TB /srv/share/MacMiniTorrents /mnt/hdd1tb; do printf '   %-28s %s\n' "$p" "$("$SCRIPT" "$p")"; done
echo "== 4. Правка конфига во временном файле + testparm"; TMP=$(mktemp)
awk '{print} /^\[MacMini\]/{s=1;next} /^\[/{s=0} s&&/^[[:space:]]*path[[:space:]]*=[[:space:]]*\/srv\/share[[:space:]]*$/&&!d{print "\tdfree command = /usr/local/sbin/smb-dfree.sh"; print "\tdfree cache time = 60"; d=1}' "$LIVE" > "$TMP"
grep -q 'dfree command' "$TMP" || { rm -f "$TMP"; echo "Не нашёл 'path = /srv/share' в [MacMini] — конфиг не тронут" >&2; exit 1; }
testparm -s "$TMP" >/dev/null 2>"$TMP.err" || { cat "$TMP.err" >&2; rm -f "$TMP" "$TMP.err"; echo "testparm не прошёл — рабочий конфиг не тронут" >&2; exit 1; }
echo "   ok"
echo "== 5. Установка и reload"; install -o root -g root -m 644 "$TMP" "$LIVE"; rm -f "$TMP" "$TMP.err"; smbcontrol all reload-config; sleep 1
echo "== 6. Проверка (нужен пароль macmini: smbclient -U macmini)"; testparm -s 2>/dev/null | grep -E 'dfree|veto files|wide links' | sed 's/^/   /'
echo "   Руками: smbclient //127.0.0.1/MacMini -U macmini -c 'du; cd 1TB; du; ls'"
echo "Готово. В Finder переподключите шару (⌘K). Откат: sudo $DIR/rollback-dfree.sh"
