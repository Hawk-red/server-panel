#!/bin/bash
# Откат единой шары: вернуть прежний smb.conf (последняя резервная копия install.sh) и перечитать конфиг. Данные не трогает.
# Корень /srv/share остаётся (безвреден); убрать: sudo rm -rf /srv/share (только символические ссылки, цели не затрагиваются).
# ACL, добавленные на /srv/exchange (macmini, hawk), снимаются: SFTPGo и панель работают как раньше.
# Запуск: sudo /opt/server-panel/deploy/samba/rollback.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
LAST=$(ls -1t /etc/samba/smb.conf.bak-before-macmini-share-* 2>/dev/null | head -1 || true)
if [[ -z "$LAST" ]]; then LAST="$(cd "$(dirname "$0")" && pwd)/smb.conf.before"; echo "Копия install.sh не найдена, беру $LAST"; fi
echo "Возвращаю $LAST"
cp -p /etc/samba/smb.conf "/root/backup-configs/smb.conf.before-rollback-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
testparm -s "$LAST" >/dev/null 2>&1 || { echo "testparm копии не прошёл — откат остановлен" >&2; exit 1; }
install -o root -g root -m 644 "$LAST" /etc/samba/smb.conf
smbcontrol all reload-config
[[ -d /srv/exchange ]] && { setfacl -R -x u:macmini,d:u:macmini,u:hawk,d:u:hawk /srv/exchange 2>/dev/null || true; echo "ACL macmini/hawk на /srv/exchange сняты (u:panel остался)"; }
echo "Готово: шары 1TB, FLAC, MacMIniTorrents снова видны в списке."
smbclient -L //127.0.0.1 -N 2>/dev/null | grep -E "Disk" | sed 's/^/  /' || true
