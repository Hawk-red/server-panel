#!/bin/bash
# Сторож обменника SFTPGo (cron hawk, раз в минуту): обменник живёт на hdd1tb (/srv/exchange → /mnt/hdd1tb/sftpgo-data).
#  • диск не смонтирован → контейнер останавливается (не пишет и не создаёт папку на SSD), запуск — когда диск вернётся;
#  • диск смонтирован, а контейнер остановлен из-за ошибки запуска (диска не было при старте) → запускается;
#  • контейнер привязан к старому монтированию (диск переподключён под новым номером) → перезапуск;
#  • контейнер видит /data/exchange на системном диске → останавливается и пишет ОПАСНО в журнал.
# Остановленный вручную контейнер (без ошибки запуска) сторож не трогает. Работает только пока /srv/exchange — ссылка (после отката выключается сам).
# Журнал: ~/sftpgo-guard.log. Все пути переопределяются переменными GUARD_* (для тестов); GUARD_DRY=1 — только показать действия.
set -u
CONTAINER=${GUARD_CONTAINER:-sftpgo}
DISK=${GUARD_DISK:-/mnt/hdd1tb}
LINK=${GUARD_LINK:-/srv/exchange}
DEST=${GUARD_DEST:-/data/exchange}
LOG=${GUARD_LOG:-/home/hawk/sftpgo-guard.log}
FLAG=${GUARD_FLAG:-/home/hawk/.sftpgo-guard-stopped}
LAST=${GUARD_LAST:-/home/hawk/.sftpgo-guard-last}
PROC=${GUARD_PROC:-/proc}
DRY=${GUARD_DRY:-0}

exec 9>"${GUARD_LOCK:-/tmp/sftpgo-guard.lock}"; flock -n 9 || exit 0
[ -L "$LINK" ] || exit 0                       # режим «обменник на диске» выключен (откат)
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 262144 ]; then tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
# в журнал — только при смене состояния, иначе минутные повторы забьют файл
note() { [ "$(cat "$LAST" 2>/dev/null)" = "$1" ] || { log "$1"; echo "$1" > "$LAST"; }; }
act() { if [ "$DRY" = 1 ]; then echo "DRY docker $*"; else docker "$@" >/dev/null 2>>"$LOG" || log "docker $* — ошибка"; fi; }
insp() { docker inspect -f "$1" "$CONTAINER" 2>/dev/null; }

status=$(insp '{{.State.Status}}') || exit 0     # контейнера нет — сторожить нечего
stop_it() { [ "$status" = running ] && act stop -t 20 "$CONTAINER"; : > "$FLAG"; }

if ! mountpoint -q "$DISK"; then
  note "диск $DISK не смонтирован: обменник остановлен"; stop_it; exit 0
fi
real=$(readlink -f "$LINK")
case "$real" in "$DISK"/*) ;; *) note "ВНИМАНИЕ: $LINK указывает не на диск ($real): обменник остановлен"; stop_it; exit 0;; esac
[ -d "$real" ] || { note "нет каталога данных $real: обменник остановлен"; stop_it; exit 0; }

want=$(mountpoint -d "$DISK"); root=$(mountpoint -d /)
case "$status" in
  running)
    pid=$(insp '{{.State.Pid}}')
    cdev=$(awk -v d="$DEST" '$5==d {dev=$3} END {print dev}' "$PROC/$pid/mountinfo" 2>/dev/null)
    if [ -z "$cdev" ]; then note "не вижу монтирование $DEST в контейнере (нет доступа к mountinfo)"; exit 0; fi
    if [ "$cdev" = "$root" ]; then note "ОПАСНО: контейнер видит $DEST на системном диске: остановлен"; stop_it; exit 0; fi
    if [ "$cdev" != "$want" ]; then note "контейнер привязан к старому монтированию ($cdev, диск сейчас $want): перезапуск"; act restart -t 20 "$CONTAINER"; exit 0; fi
    note "ок: обменник на диске $DISK ($want)"; rm -f "$FLAG"
    ;;
  exited|created|dead)
    err=$(insp '{{.State.Error}}')
    if [ -e "$FLAG" ] || [ -n "$err" ] || [ "$status" = created ]; then
      note "диск смонтирован, обменник остановлен (${err:-остановлен сторожем}): запуск"; act start "$CONTAINER"; rm -f "$FLAG"
    fi
    ;;
esac
exit 0
