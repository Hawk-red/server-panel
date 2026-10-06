#!/bin/bash
# Единая шара MacMini: резервная копия, проверка, установка smb.conf, reload (НЕ restart: текущие передачи не рвутся).
# Запуск: sudo /opt/server-panel/deploy/samba/install.sh
# Откат одной командой: sudo /opt/server-panel/deploy/samba/rollback.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
LIVE=/etc/samba/smb.conf
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"; chmod 700 "$BK"

echo "== 1. Кто подключён сейчас (до изменений)"
smbstatus -b 2>/dev/null || true; smbstatus -S 2>/dev/null | head -20 || true

echo "== 2. Резервная копия"
cp -p "$LIVE" "$BK/smb.conf.before-macmini-share-$TS"
cp -p "$LIVE" "$LIVE.bak-before-macmini-share-$TS"
echo "   $BK/smb.conf.before-macmini-share-$TS"
if ! cmp -s "$LIVE" "$DIR/smb.conf.before"; then
  echo "   ВНИМАНИЕ: рабочий smb.conf отличается от того, на основе которого готовился новый (smb.conf.before)." >&2
  echo "   Новые строки будут взяты из $DIR/smb.conf целиком; проверьте diff: diff $LIVE $DIR/smb.conf" >&2
  [[ "${FORCE:-}" == 1 ]] || { echo "   Для продолжения запустите с FORCE=1" >&2; exit 1; }
fi

echo "== 3. Корень шары и права Exchange"
"$DIR/share-tree.sh"

echo "== 4. Проверка нового конфига (testparm)"
TMP=$(mktemp); cp "$DIR/smb.conf" "$TMP"
testparm -s "$TMP" >/dev/null 2>"$TMP.err" || { cat "$TMP.err" >&2; echo "testparm не прошёл — рабочий конфиг не тронут" >&2; rm -f "$TMP" "$TMP.err"; exit 1; }
rm -f "$TMP" "$TMP.err"; echo "   ok"

echo "== 5. Установка и перечитывание (reload, без перезапуска)"
install -o root -g root -m 644 "$DIR/smb.conf" "$LIVE"
smbcontrol all reload-config
sleep 1

echo "== 6. Проверка"
echo "   список шар, который увидит Finder (только MacMini + IPC$):"
smbclient -L //127.0.0.1 -N 2>/dev/null | grep -E "Disk|IPC" | sed 's/^/     /' || true
for sh in 1TB FLAC MacMIniTorrents MacMini; do
  r=$(smbclient //127.0.0.1/$sh -N -c ls 2>&1 | head -1 || true)
  if grep -q BAD_NETWORK_NAME <<<"$r"; then echo "   $sh: ШАРЫ НЕТ (BAD_NETWORK_NAME)" >&2; else echo "   $sh: шара существует (без пароля отвечает: ${r:0:60})"; fi
done
echo "   подключения после reload:"; smbstatus -b 2>/dev/null || true
echo
echo "Готово. Подключение: smb://192.168.31.112/MacMini (или smb://192.168.31.112 — в списке будет одна шара MacMini)."
echo "Откат: sudo $DIR/rollback.sh"
