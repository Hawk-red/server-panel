# Перенос торрентов с SSD на hdd1tb (05.10.2026)

## Что сделано
1. Копия DTS-MusicDemo_BDRemux на `/mnt/hdd1tb/qbittorrent-completed/` проверена: 170 383 851 040 байт, 180 файлов, SHA-256 двух крупнейших файлов совпадает.
2. Исходная папка на SSD (`/home/torrents-tmp/DTS-MusicDemo_BDRemux`) удалена. Корень: 98% → 25%.
3. Контейнер qBittorrent пересоздан: binds `/completed` и `/downloads-hdd` на hdd1tb, без `/downloads` (корень) и `/downloads-final` (uploads1). `TZ=Europe/Kyiv`, `restart=unless-stopped`, конфиг `/opt/qbittorrent/config` сохранён.
4. Настройки qBittorrent: `save_path=/downloads-hdd`, `temp_path=/downloads-hdd/.incomplete`, `temp_path_enabled=true`, `autorun_enabled=false`.
5. `torrent-space-guard.sh`: смотрит на `/mnt/hdd1tb`, пороги 50/100 ГБ, проверка `mountpoint` (при отвале диска — пауза и запись в лог). Старая версия: `torrent-space-guard.sh.bak-20261005`.
6. JRiver переназначен на `/downloads-hdd` (данных нет, перенос прошёл).

## Что случилось по пути (важно для истории)
- Старый guard по cron (13:05:01) увидел 163 ГБ свободно на корне, написал `SPACE OK` и снял паузу со всех торрентов. Торренты стали качаться по новой в `/downloads-tmp` (корень). Остановлено вручную, частичные данные (~150 МБ) удалены с SSD.
- `setLocation` для DTS на `/completed` **не сработал**: qBittorrent при переносе ищет данные в старом месте (`/downloads-tmp`) и падает с `partfile_move: No such file`. Торрент остаётся на `/downloads-tmp`, на паузе, данные — только в `/completed`.

## Не сделано (ждёт решения)
- DTS: привязать торрент к `/completed` и выполнить recheck. Варианты: удалить запись торрента из qBittorrent **без** удаления файлов и заново добавить `.torrent` (из `BT_backup`) с `savepath=/completed`; либо оставить как есть.
- Пауза DTS не снимается, пока recheck не подтвердит 100% и отсутствие загрузки.
- `/home/torrents-tmp` оставлен пустой папкой для отката (bind `/downloads-tmp` в контейнере сохранён).
