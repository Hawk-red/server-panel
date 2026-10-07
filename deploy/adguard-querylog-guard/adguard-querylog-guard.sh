#!/bin/bash
# Страховка роста журнала запросов AdGuard (cron hawk, раз в сутки). НИЧЕГО НЕ УДАЛЯЕТ.
# Считает суммарный размер querylog.json* внутри контейнера adguardhome; если больше лимита (по умолчанию 1 ГБ),
# пишет предупреждение в ~/adguard-querylog-guard.log. В /var/log/torrent-move.log не пишет: его разбирает панель по жёсткому формату,
# новый вид события в панели потребовал бы правки detectors.ts (см. отчёт).
# Лимит и срок хранения: querylog.interval в AdGuardHome.yaml (сейчас 7d: максимум ≈ 2 × 7 суток ≈ 0,5 ГБ).
# Переопределения для тестов: GUARD_CONTAINER, GUARD_LIMIT_MB, GUARD_LOG.
set -u
CONTAINER=${GUARD_CONTAINER:-adguardhome}
LIMIT_MB=${GUARD_LIMIT_MB:-1024}
LOG=${GUARD_LOG:-/home/hawk/adguard-querylog-guard.log}
DIR=/opt/adguardhome/work/data

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 262144 ]; then tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

bytes=$(docker exec "$CONTAINER" sh -c "total=0; for f in $DIR/querylog.json*; do [ -f \"\$f\" ] && total=\$((total + \$(stat -c %s \"\$f\"))); done; echo \$total" 2>/dev/null) || { log "не удалось прочитать размер журнала (контейнер $CONTAINER не отвечает)"; exit 0; }
mb=$((bytes / 1024 / 1024))

if [ "$mb" -gt "$LIMIT_MB" ]; then
  interval=$(docker exec "$CONTAINER" sh -c "grep -A3 '^querylog:' /opt/adguardhome/conf/AdGuardHome.yaml | grep -m1 interval" 2>/dev/null | tr -s ' ')
  log "ВНИМАНИЕ: журнал запросов AdGuard ${mb} МБ > ${LIMIT_MB} МБ (${interval# }). Проверьте querylog.interval; ничего не удалено"
else
  log "ok: журнал запросов AdGuard ${mb} МБ (лимит ${LIMIT_MB} МБ)"
fi
