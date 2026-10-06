# Единая шара MacMini (Samba)

В Finder при подключении к `smb://192.168.31.112` виден один том **MacMini** с папками `1TB`, `FLAC`, `MacMiniTorrents`, `SFTPGo`.
Старые шары (`1TB`, `FLAC`, `MacMIniTorrents`) остались под теми же именами и путями, но `browseable = no`: по имени
(`smb://192.168.31.112/1TB`, автоподключение MacBook, бэкап iPad в `/Volumes/1TB/ipad-backup`) работают как раньше.

## Установка / откат
- `sudo deploy/samba/install.sh` — резервные копии, `testparm`, `share-tree.sh`, установка `smb.conf`, `smbcontrol all reload-config` (не restart).
- `sudo deploy/samba/rollback.sh` — вернуть прежний `smb.conf` (последняя копия), снять ACL, reload.
- `sudo deploy/samba/share-tree.sh` — только корень шары (ссылки) и права каталога обменника `/srv/exchange` (запускать заново, когда `/srv/exchange` станет точкой монтирования нового диска).
- `sudo deploy/samba/test-remount.sh` — доказательство «ссылки, а не bind» на временном loop-образе (реальные диски не трогает).

## Решения
- **Символические ссылки вместо bind**: bind привязан к файловой системе и после `umount -l` + `mount` показывает старую пустую папку; ссылка
  разыменовывается по пути при каждом обращении. Нужны `wide links = yes` (на шаре MacMini), `allow insecure wide links = yes` и `unix extensions = no`
  (глобально). Расширения Unix относятся к SMB1, а `min protocol = SMB2`, поэтому macOS-клиенты (SMB2/3) это не затрагивает; на старых шарах `wide links` не включён.
- **Корень `/srv/share`** принадлежит root (755): создавать в нём нечего, пишется только внутри папок-целей (права файловых систем целей, пользователь `macmini`, как у старых шар).
- **veto files** (вместо hide files, который Finder показывал): `lost+found` — в `1TB` и `MacMini`; `qbittorrent-completed` (пустая, контейнер qBittorrent использует её как `/completed`) — в обеих шарах; `qbittorrent-downloads` — только в `MacMini`; **`sftpgo-data`** (настоящий каталог данных обменника на hdd1tb) — в обеих шарах: обменник виден как `SFTPGo` через ссылку, дубля нет. Файлы и папки на диске не меняются; `delete veto files = no`. Применение по порядку: `apply-veto.sh`, `apply-veto-completed.sh`, `apply-veto-sftpgo-data.sh`; откат: `rollback-veto-sftpgo-data.sh` (и предыдущие `rollback-…`).
- **SFTPGo** (ссылка `/srv/share/SFTPGo → /srv/exchange`; прежнее имя ссылки — `Exchange`, `share-tree.sh` при запуске переименовывает или убирает её): на `/srv/exchange` добавлены ACL `macmini` (rwX) и `hawk` (rwX) рядом с `panel` (rX), в том числе default-ACL, чтобы SFTPGo (uid 1001 = hawk) мог работать с файлами,
  созданными через SMB (владелец у них macmini).
- **Квота SFTPGo**: файлы, добавленные через SMB, SFTPGo сам не видит; их учитывает только пересчёт квоты (по README панели — раз в час, либо вручную в админке «Quota scan»).
  Запись по SMB квоту не проверяет и может её превысить: после этого веб-клиент перестанет принимать новые загрузки, пока не освободится место.
- **hosts allow** задан только у новой шары (LAN, WireGuard, localhost); у старых его нет, их закрывает ufw.

## Где лежит DTS
Папка `DTS-MusicDemo_BDRemux` (≈170 ГБ) находится в корне hdd1tb: `/mnt/hdd1tb/DTS-MusicDemo_BDRemux`, то есть `1TB/DTS-MusicDemo_BDRemux` в Finder. `qbittorrent-completed` и `qbittorrent-downloads` удаляются только после завершения торрента DTS и вместе с пересозданием контейнера qBittorrent (см. `deploy/torrents-migration/README.md`).
