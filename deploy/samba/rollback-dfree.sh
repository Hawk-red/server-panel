#!/bin/bash
# Откат dfree: вернуть smb.conf из последней копии apply-dfree.sh, testparm, reload. Скрипт /usr/local/sbin/smb-dfree.sh остаётся (без строки в конфиге не используется).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
LAST=$(ls -1t /etc/samba/smb.conf.bak-before-dfree-* 2>/dev/null | head -1 || true); [[ -n "$LAST" ]] || { echo "Копий smb.conf.bak-before-dfree-* нет" >&2; exit 1; }
echo "Возвращаю $LAST"; testparm -s "$LAST" >/dev/null 2>&1 || { echo "testparm не прошёл — откат остановлен" >&2; exit 1; }
install -o root -g root -m 644 "$LAST" /etc/samba/smb.conf; smbcontrol all reload-config; echo "Готово."
