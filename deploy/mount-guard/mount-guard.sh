#!/bin/bash
# /usr/local/sbin/mount-guard.sh — сторож монтирования USB-дисков при загрузке (mount-guard.service).
# Ждёт появления дисков по UUID (до WAIT_SECONDS), монтирует по fstab те, что не смонтированы, и, если
# hdd1tb смонтирован, проверяет контейнеры, упавшие при старте из-за отсутствия диска.
# НЕ запускает fsck, НЕ использует -o force, ничего не знает про /dev/sdX (только UUID).
# Контейнеры по умолчанию НЕ запускает (AUTO_START_CONTAINERS=no): пишет в лог и шлёт уведомление в Telegram
# через панель (строка «EVENT …» в логе → детектор mountGuardLog в панели → событие → правило «mount»).
# DRY_RUN=1 — только пишет в stdout, что сделал бы (ни mount, ни docker start, ни записи в лог).
# Для тестов пути и команды переопределяются переменными MG_* (см. ниже).
set -u

CONF=${MG_CONF:-/etc/mount-guard.conf}
# значения по умолчанию (перекрываются конфигом)
WAIT_SECONDS=180
RETRY_INTERVAL=5
MOUNT_TIMEOUT=60
AUTO_START_CONTAINERS=no
CONTAINERS="qbittorrent sftpgo"
NOTIFY=yes
LOG=/var/log/mount-guard.log
# DISKS: имя|UUID|точка монтирования|bind-точка (необязательно)
DISKS=(
  "hdd1tb|99617d83-59c3-4505-8281-6e3bf0383b54|/mnt/hdd1tb|"
  "uploads1|6A0A-E4C4|/mnt/uploads1|/var/www/www/jetsetter.ua/wp-content/uploads"
  "uploads2|6A0A-ECCB|/mnt/uploads2|"
)
# для контейнеров: каталоги на hdd1tb, без которых запускать смысла нет
HDD_NAME=hdd1tb
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
DRY_RUN=${DRY_RUN:-0}
BYUUID=${MG_BYUUID:-/dev/disk/by-uuid}
# Ошибки запуска контейнера, считающиеся «диска не было» (State.Error)
MOUNT_ERR_RE=${MG_ERR_RE:-'mount request|no such file or directory|bind source path does not exist'}

FINDMNT=${MG_FINDMNT:-findmnt}
MOUNT=${MG_MOUNT:-mount}
DOCKER=${MG_DOCKER:-docker}
SLEEP=${MG_SLEEP:-sleep}

log() {
  local line; line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] $line"; else echo "$line" >> "$LOG"; fi
}
dry() { [ "$DRY_RUN" = 1 ]; }

# Событие для панели. Формат строки: EVENT <kind> key=value ... (значения без пробелов)
# В dry-run строки EVENT не пишутся в лог (детектор панели их бы подхватил) — только в stdout.
event() { [ "$NOTIFY" = yes ] || return 0; log "EVENT $*"; }

is_mounted() { # uuid mountpoint — смонтирован ли том с этим UUID именно в этой точке
  "$FINDMNT" -rn -S "UUID=$1" -o TARGET 2>/dev/null | grep -qxF "$2"
}
mp_busy() { "$FINDMNT" -rn -M "$1" >/dev/null 2>&1; } # в точке что-то смонтировано (для bind)

# --- lock: один экземпляр ----------------------------------------------------------------------
if [ "$DRY_RUN" != 1 ]; then
  exec 9>"${MG_LOCK:-/run/mount-guard.lock}"
  flock -n 9 || { log "уже запущен другой экземпляр — выход"; exit 0; }
fi

log "старт mount-guard (ожидание до ${WAIT_SECONDS} с, AUTO_START_CONTAINERS=$AUTO_START_CONTAINERS$([ "$DRY_RUN" = 1 ] && echo ', DRY_RUN=1'))"

# --- 1. диски -----------------------------------------------------------------------------------
declare -A STATE   # name → ok | failed
declare -A WASLATE # name → 1, если смонтировали мы (а не система)
deadline=$(( $(date +%s) + WAIT_SECONDS ))
pending=()
for d in "${DISKS[@]}"; do pending+=("$d"); done

while :; do
  still=()
  for d in "${pending[@]}"; do
    IFS='|' read -r name uuid mnt bind <<<"$d"
    if is_mounted "$uuid" "$mnt"; then
      [ -n "${STATE[$name]:-}" ] || log "$name: уже смонтирован в $mnt (UUID $uuid)"
      STATE[$name]=ok
    elif [ -e "$BYUUID/$uuid" ]; then
      if dry; then
        log "$name: устройство есть, не смонтировано — выполнил бы: mount $mnt"
        STATE[$name]=ok   # dry-run: считаем успехом, чтобы пройти дальше
        WASLATE[$name]=1
      else
        log "$name: устройство есть, не смонтировано — mount $mnt"
        if out=$(timeout "$MOUNT_TIMEOUT" "$MOUNT" "$mnt" 2>&1) || is_mounted "$uuid" "$mnt"; then
          log "$name: $mnt смонтирован"; STATE[$name]=ok; WASLATE[$name]=1
        else
          log "$name: ошибка mount $mnt: ${out//$'\n'/ } (повтор)"; still+=("$d"); continue
        fi
      fi
    else
      still+=("$d"); continue   # устройства ещё нет
    fi
    # bind (uploads1 → wp-content/uploads): только если основной том смонтирован
    if [ -n "$bind" ] && [ "${STATE[$name]}" = ok ] && ! mp_busy "$bind"; then
      if dry; then log "$name: выполнил бы: mount $bind"
      elif out=$(timeout "$MOUNT_TIMEOUT" "$MOUNT" "$bind" 2>&1); then log "$name: bind $bind смонтирован"
      else log "$name: ошибка bind $bind: ${out//$'\n'/ }"; fi
    fi
  done
  pending=("${still[@]}")
  [ "${#pending[@]}" -eq 0 ] && break
  if [ -z "${WAITLOGGED:-}" ]; then
    WAITLOGGED=1; w=; for d in "${pending[@]}"; do w+="${d%%|*} "; done
    log "жду диски (${w% }) до ${WAIT_SECONDS} с"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then break; fi
  if dry && [ "${MG_DRY_ONCE:-1}" = 1 ]; then break; fi   # в dry-run не ждём 3 минуты
  "$SLEEP" "$RETRY_INTERVAL"
done

for d in "${pending[@]}"; do
  IFS='|' read -r name uuid mnt _ <<<"$d"
  STATE[$name]=failed
  if [ -e "$BYUUID/$uuid" ]; then why="устройство есть, но mount не удался"; else why="устройство с UUID $uuid не появилось"; fi
  log "$name: НЕ СМОНТИРОВАН за ${WAIT_SECONDS} с ($why)"
  event "mount.failed disk=$name mnt=$mnt reason=$([ -e "$BYUUID/$uuid" ] && echo mount-error || echo no-device)"
done

# --- 2. контейнеры, упавшие из-за отсутствия hdd1tb --------------------------------------------
hdd_mnt=
for d in "${DISKS[@]}"; do IFS='|' read -r name _ mnt _ <<<"$d"; [ "$name" = "$HDD_NAME" ] && hdd_mnt=$mnt; done

if [ "${STATE[$HDD_NAME]:-}" != ok ]; then
  log "$HDD_NAME не смонтирован — контейнеры не проверяю"
else
  # ждём Docker (сторож стартует после docker.service, но демон может ещё подниматься)
  until "$DOCKER" info >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then log "Docker не отвечает — контейнеры не проверяю"; exit 0; fi
    dry && { log "Docker не отвечает (dry-run) — контейнеры не проверяю"; exit 0; }
    "$SLEEP" "$RETRY_INTERVAL"
  done
  affected=(); started=()
  for c in $CONTAINERS; do
    info=$("$DOCKER" inspect -f '{{.State.Status}}|{{.State.Error}}' "$c" 2>/dev/null) || { log "контейнер $c не найден — пропускаю"; continue; }
    status=${info%%|*}; err=${info#*|}
    case "$status" in
      running) log "контейнер $c: running — ок"; continue ;;
      exited|created|dead) ;;
      *) log "контейнер $c: статус $status — не трогаю"; continue ;;
    esac
    # ключевое условие: остановлен именно из-за ошибки монтирования; остановленный вручную (Error пуст) не трогаем
    if [ -n "$err" ] && grep -qiE "$MOUNT_ERR_RE" <<<"$err"; then
      log "контейнер $c: $status из-за ошибки монтирования («${err:0:160}»)"
      affected+=("$c")
    else
      log "контейнер $c: $status без ошибки монтирования (остановлен вручную?) — не трогаю"
    fi
  done

  if [ "${#affected[@]}" -gt 0 ]; then
    names=$(IFS=,; echo "${affected[*]}")
    if [ "$AUTO_START_CONTAINERS" = yes ]; then
      for c in "${affected[@]}"; do
        if dry; then log "выполнил бы: docker start $c"; started+=("$c")
        elif "$DOCKER" start "$c" >/dev/null 2>>"$LOG"; then log "контейнер $c: запущен (docker start)"; started+=("$c")
        else log "контейнер $c: docker start не удался"; fi
      done
      event "mount.late disk=$HDD_NAME containers=$names action=started started=$(IFS=,; echo "${started[*]:-none}")"
    else
      log "AUTO_START_CONTAINERS=no — контейнеры не запускаю: $names. Запустите вручную: docker start ${affected[*]}"
      event "mount.late disk=$HDD_NAME containers=$names action=none"
    fi
  else
    log "контейнеры в порядке — действий не требуется"
  fi
fi

# итог
fails=0; for k in "${!STATE[@]}"; do [ "${STATE[$k]}" = ok ] || fails=$((fails+1)); done
log "готово (не смонтировано: $fails)"
exit 0
