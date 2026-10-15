# mount-guard — устойчивая загрузка с USB-дисками

**Проблема (16.10.2026):** после аварийного отключения света `systemd-fsck@…hdd1tb` отработал («clean»), но процесс был
убит TERM (гонка systemd/fsckd, не таймаут: всё заняло ~1 с), `mnt-hdd1tb.mount` остался `inactive (dead)`. Docker стартовал,
`qbittorrent` и `sftpgo` упали с «mount request: no such file or directory» и из-за `unless-stopped` не поднялись.

## Что делает
- `mount-guard.sh` (`/usr/local/sbin`) + `mount-guard.service` (`Type=simple`, `After=local-fs.target docker.service`,
  **без** Requires/Wants/RequiresMountsFor): ждёт до `WAIT_SECONDS` (180 с) появления `/dev/disk/by-uuid/<UUID>` для hdd1tb,
  uploads1, uploads2 и монтирует по fstab (`mount /mnt/…`, `timeout`, повторы), если `findmnt -S UUID=…` не показывает нужную
  точку. Для uploads1 ещё bind на `wp-content/uploads`. Без fsck, без `-o force`. Лог — `/var/log/mount-guard.log`.
- Если hdd1tb смонтирован — проверяет `qbittorrent` и `sftpgo`: статус exited/created/dead **и** `State.Error` содержит
  «mount request» / «no such file or directory» / «bind source path does not exist». Остановленные вручную (Error пуст) не трогает.
  `AUTO_START_CONTAINERS=no` (по умолчанию) → ничего не запускает, пишет в лог и шлёт уведомление. `yes` → `docker start`
  только для таких контейнеров.
- Уведомления: сторож пишет в лог строки `EVENT mount.late …` / `EVENT mount.failed …`; детектор панели (`detectors.ts`,
  `mountGuardLog`) превращает их в события, `notifier.ts` — в Telegram (правило «mount», тихие часы 00–09 без звука, антидубль 10 мин).
- `DRY_RUN=1` — всё только в stdout (ни mount, ни docker start, ни записи в лог/события).
- `/home/hawk/disk-monitor.sh` (cron, каждую минуту) теперь тоже следит за hdd1tb по UUID (только «смонтирован ли», без
  перезапуска контейнеров). Для его `sudo mount /mnt/hdd1tb` ставится `/etc/sudoers.d/disk-monitor-hdd1tb` (одна команда).
  Бэкап: `/home/hawk/disk-monitor.sh.bak-20261016`.

## Установка (из обычного терминала сервера)
1. `sudo /opt/server-panel/deploy/mount-guard/install.sh`
2. Уведомления (код панели): `/opt/server-panel/deploy/update.sh && sudo systemctl restart server-panel`
3. Проверка без последствий: `sudo DRY_RUN=1 /usr/local/sbin/mount-guard.sh` (при смонтированных дисках скажет «уже смонтирован»).

install.sh ничего не монтирует и не запускает, только включает юнит на следующую загрузку (`sudo systemctl start mount-guard`
можно выполнить сразу — на смонтированные тома он не влияет). Существующий `/etc/mount-guard.conf` не перезаписывается.

## Откат
`sudo /opt/server-panel/deploy/mount-guard/rollback.sh` (удаляет юнит, скрипт, sudoers-файл, logrotate; конфиг и лог остаются).
Код панели откатывается `git revert` коммита и повтором шага 2.

## Замечания
- Параллельно работает cron-сторож `~/Scripts/sftpgo-guard.sh`: он сам запускает `sftpgo` раз в минуту, когда диск смонтирован
  и контейнер остановлен с ошибкой запуска. Поэтому `sftpgo` фактически поднимется сам, даже при `AUTO_START_CONTAINERS=no`.
- Docker к дискам не привязан: AdGuardHome (DNS сети) стартует независимо. Drop-in `After=mnt-hdd1tb.mount` не нужен и вреден:
  при отсутствии диска он не помог бы (юнит dead), а `Wants=` заставил бы Docker ждать device-timeout (до 90 с).
