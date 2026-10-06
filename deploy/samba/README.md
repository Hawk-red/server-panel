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
- **veto files** (вместо hide files, который Finder показывал): `lost+found` невидим и недоступен в `1TB` и в `MacMini`, `qbittorrent-downloads` — только в `MacMini` (в `1TB` и в qBittorrent он на месте). Файлы на диске не меняются; `delete veto files = no`. Применение: `apply-veto.sh`, откат: `rollback-veto.sh`.
- **SFTPGo** (ссылка `/srv/share/SFTPGo → /srv/exchange`; прежнее имя ссылки — `Exchange`, `share-tree.sh` при запуске переименовывает или убирает её): на `/srv/exchange` добавлены ACL `macmini` (rwX) и `hawk` (rwX) рядом с `panel` (rX), в том числе default-ACL, чтобы SFTPGo (uid 1001 = hawk) мог работать с файлами,
  созданными через SMB (владелец у них macmini).
- **Квота SFTPGo**: файлы, добавленные через SMB, SFTPGo сам не видит; их учитывает только пересчёт квоты (по README панели — раз в час, либо вручную в админке «Quota scan»).
  Запись по SMB квоту не проверяет и может её превысить: после этого веб-клиент перестанет принимать новые загрузки, пока не освободится место.
- **hosts allow** задан только у новой шары (LAN, WireGuard, localhost); у старых его нет, их закрывает ufw.
