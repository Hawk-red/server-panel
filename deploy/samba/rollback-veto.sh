#!/bin/bash
# Откат veto files → hide files: последняя копия apply-veto.sh (или smb.conf.v1-hide из репозитория), testparm, reload.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
LAST=$(ls -1t /etc/samba/smb.conf.bak-before-veto-* 2>/dev/null | head -1 || true); [[ -n "$LAST" ]] || LAST="$DIR/smb.conf.v1-hide"
echo "Возвращаю $LAST"; testparm -s "$LAST" >/dev/null 2>&1 || { echo "testparm не прошёл — откат остановлен" >&2; exit 1; }
install -o root -g root -m 644 "$LAST" /etc/samba/smb.conf; smbcontrol all reload-config; echo "Готово."
