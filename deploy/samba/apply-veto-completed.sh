#!/bin/bash
# Скрыть qbittorrent-completed в шарах 1TB и MacMini (veto files): резервная копия, testparm, reload (НЕ restart). Файлы и папку на диске не трогает.
# Запуск: sudo /opt/server-panel/deploy/samba/apply-veto-completed.sh        Откат: sudo /opt/server-panel/deploy/samba/rollback-veto-completed.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; LIVE=/etc/samba/smb.conf
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"; chmod 700 "$BK"
nocomment() { grep -vE '^\s*[#;]' "$1"; }   # сравнение без комментариев: в рабочем файле они могут отличаться
echo "== 1. Кто подключён сейчас"; smbstatus -b 2>/dev/null || true
if ! diff <(nocomment "$LIVE") <(nocomment "$DIR/smb.conf.v2-veto") >/dev/null; then
  echo "ВНИМАНИЕ: рабочий smb.conf отличается от ожидаемой версии (smb.conf.v2-veto) не только комментариями:" >&2
  diff <(nocomment "$LIVE") <(nocomment "$DIR/smb.conf.v2-veto") | head -10 >&2
  [[ "${FORCE:-}" == 1 ]] || { echo "Для продолжения: FORCE=1 sudo $0" >&2; exit 1; }
fi
echo "== 2. Резервная копия"; cp -p "$LIVE" "$BK/smb.conf.before-veto-completed-$TS"; cp -p "$LIVE" "$LIVE.bak-before-veto-completed-$TS"; echo "   $BK/smb.conf.before-veto-completed-$TS"
echo "== 3. testparm"; TMP=$(mktemp); cp "$DIR/smb.conf" "$TMP"
testparm -s "$TMP" >/dev/null 2>"$TMP.err" || { cat "$TMP.err" >&2; rm -f "$TMP" "$TMP.err"; echo "testparm не прошёл — рабочий конфиг не тронут" >&2; exit 1; }
rm -f "$TMP" "$TMP.err"; echo "   ok"
echo "== 4. Установка и reload"; install -o root -g root -m 644 "$DIR/smb.conf" "$LIVE"; smbcontrol all reload-config; sleep 1
echo "== 5. Проверка"; grep -nE "^\s*veto files" "$LIVE" | sed 's/^/   /'
for sh in 1TB MacMini; do r=$(smbclient //127.0.0.1/$sh -N -c ls 2>&1 | head -1 || true); grep -q BAD_NETWORK_NAME <<<"$r" && echo "   $sh: ШАРЫ НЕТ" >&2 || echo "   $sh: шара на месте"; done
echo "   папка на диске цела: $(ls -ld /mnt/hdd1tb/qbittorrent-completed 2>&1 | cut -c1-60)"
echo "   подключения после reload:"; smbstatus -b 2>/dev/null || true
echo "Готово. В Finder переподключите шару (⌘K или отключить и открыть заново)."
echo "Откат: sudo $DIR/rollback-veto-completed.sh"
