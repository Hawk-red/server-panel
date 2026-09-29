#!/bin/bash
# Раз в час (cron hawk): отправляет коммиты панели на GitHub, только если есть неотправленные.
# Состояние последнего запуска — .autopush-status.json (читает панель, вкладка «Изменения панели»).
set -uo pipefail
cd /opt/server-panel
STATUS=/opt/server-panel/.autopush-status.json
LOG=/opt/server-panel/autopush.log
exec 9>/tmp/git-autopush.lock
flock -n 9 || exit 0

write_status() { # result count message
  printf '{"ts":%s,"result":"%s","count":%s,"message":%s}\n' "$(date +%s)000" "$1" "$2" "$(printf '%s' "$3" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()[:500]))')" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS" && chmod 644 "$STATUS"
}

branch=$(git symbolic-ref --short HEAD 2>/dev/null) || { write_status error 0 "detached HEAD"; exit 1; }
[ "$branch" = main ] || { write_status error 0 "ветка $branch, ожидалась main"; exit 1; }
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null) || { write_status error 0 "нет origin/main"; exit 1; }
if [ "$ahead" -eq 0 ]; then write_status nothing 0 ""; exit 0; fi

if out=$(timeout 90 git push origin main 2>&1); then
  write_status pushed "$ahead" ""
  echo "$(date '+%F %T') pushed $ahead" >> "$LOG"
else
  msg=$(printf '%s' "$out" | tail -3 | tr '\n' ' ')
  write_status error "$ahead" "$msg"
  echo "$(date '+%F %T') ERROR: $msg" >> "$LOG"
  exit 1
fi
