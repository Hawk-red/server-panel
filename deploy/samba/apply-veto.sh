#!/bin/bash
# Замена hide files на veto files (lost+found в 1TB и MacMini, qbittorrent-downloads в MacMini): резервная копия, testparm, reload (НЕ restart).
# Запуск: sudo /opt/server-panel/deploy/samba/apply-veto.sh        Откат: sudo /opt/server-panel/deploy/samba/rollback-veto.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; LIVE=/etc/samba/smb.conf
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"; chmod 700 "$BK"
echo "== 1. Кто подключён сейчас"; smbstatus -b 2>/dev/null || true
if ! cmp -s "$LIVE" "$DIR/smb.conf.v1-hide"; then
  echo "ВНИМАНИЕ: рабочий smb.conf не совпадает с версией с hide files (smb.conf.v1-hide); смотрите diff $LIVE $DIR/smb.conf" >&2
  [[ "${FORCE:-}" == 1 ]] || { echo "Для продолжения: FORCE=1 sudo $0" >&2; exit 1; }
fi
echo "== 2. Резервная копия"; cp -p "$LIVE" "$BK/smb.conf.before-veto-$TS"; cp -p "$LIVE" "$LIVE.bak-before-veto-$TS"; echo "   $BK/smb.conf.before-veto-$TS"
echo "== 3. testparm"; TMP=$(mktemp); cp "$DIR/smb.conf" "$TMP"
testparm -s "$TMP" >/dev/null 2>"$TMP.err" || { cat "$TMP.err" >&2; rm -f "$TMP" "$TMP.err"; echo "testparm не прошёл — рабочий конфиг не тронут" >&2; exit 1; }
rm -f "$TMP" "$TMP.err"; echo "   ok"
echo "== 4. Установка и reload"; install -o root -g root -m 644 "$DIR/smb.conf" "$LIVE"; smbcontrol all reload-config; sleep 1
echo "== 5. Проверка"; grep -nE "veto files|hide files" "$LIVE" | grep -v fruit | sed 's/^/   /'
for sh in 1TB MacMini; do r=$(smbclient //127.0.0.1/$sh -N -c ls 2>&1 | head -1 || true); grep -q BAD_NETWORK_NAME <<<"$r" && echo "   $sh: ШАРЫ НЕТ" >&2 || echo "   $sh: шара на месте"; done
echo "   подключения после reload:"; smbstatus -b 2>/dev/null || true
echo "Готово. В Finder переподключите шару (⌘K или отключить и открыть заново): уже открытое окно может держать старый список."
echo "Откат: sudo $DIR/rollback-veto.sh"
