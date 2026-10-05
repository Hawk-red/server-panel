# Доступ к панели из интернета (https://panel.pulsdev.net:9443)

**Один адрес для дома и мира: `https://panel.pulsdev.net:9443`.** Дома имя резолвится в 192.168.31.112 (AdGuard) и открывается на порту 9443 самого сервера; снаружи роутер пробрасывает 9443 на порт 443 сервера. Оба порта обслуживает один виртуальный хост `panel.pulsdev.net` (`listen 443` и `listen 9443`), правила `allow/deny`, лимиты и заголовки у них общие. На порту 9443 чужие имена (например, `api.pulsdev.net`) отвергаются на рукопожатии. Для домашней сети и VPN в ufw нужны правила на 9443: `sudo deploy/panel-https/ufw-9443.sh`.

Подготовлено, но **не включено**: живой nginx по-прежнему отвечает 403 всем, кроме 192.168.31.0/24, 10.10.10.0/24 и 127.0.0.1.

## Порядок включения

1. Установить новый код панели и перезапустить службу: `sudo systemctl restart server-panel` (сборка уже сделана `deploy/update.sh`).
2. Из домашней сети: **«Безопасность» → «Двухфакторный вход» → «Включить»**, отсканировать QR, ввести код, сохранить 10 кодов восстановления.
3. Поставить fail2ban-jail: `sudo deploy/panel-https/install-fail2ban.sh`.
4. Открыть nginx: `sudo deploy/panel-https/open-external.sh` (отказывается работать, пока 2FA не включена, jail не стоит или панель старая; при ошибке сам возвращает прежний конфиг).
5. В «Безопасности» включить выключатель **«Доступ из интернета»** (до этого снаружи 403 даже при открытом nginx).
6. Проверить с телефона: дома по Wi-Fi и по мобильному интернету (с выключенным Wi-Fi) — один и тот же адрес `https://panel.pulsdev.net:9443` → пароль (дома) или пароль + код (снаружи).

## Как закрыть обратно

- быстро, без sudo: выключить «Доступ из интернета» в «Безопасности» (внешние запросы сразу 403, внешние сессии завершаются);
- полностью: `sudo deploy/panel-https/close-external.sh` (возвращает вариант с `deny all`);
- совсем убрать хост: `sudo rm /etc/nginx/sites-enabled/panel.pulsdev.net && sudo nginx -t && sudo systemctl reload nginx`.

## Что защищает

| Слой | Что делает |
|---|---|
| nginx (`panel.pulsdev.net.open.conf`) | лимит входа 10 запросов/мин на IP (пачка 5), мягкий лимит остального API, 100 одновременных запросов, тело входа ≤ 4 КБ, остальное ≤ 64 КБ, `server_tokens off`, HSTS, `nosniff`; `X-Forwarded-For` перезаписывается значением `$remote_addr`; модуль realip не подключён. Домашняя сеть и VPN лимитам не подчиняются |
| fail2ban (`panel-auth`) | 5 неудачных POST /api/auth/* за 10 мин → бан 1 ч, повторные растут до 5 недель |
| панель: вход | снаружи пароль + код TOTP (или код восстановления); один код — один раз; одна и та же ошибка на пароль и код; задержка после неудачи |
| панель: блокировки | 5 неудач за 15 мин → блок IP на 15 мин, повторные 1 ч → 6 ч → 24 ч; общий лимит 30 неудач за 15 мин для всех внешних адресов |
| панель: сессия | снаружи 12 часов без продления; сессия, созданная изнутри, снаружи недействительна |
| панель: маршруты | любой не-GET снаружи по умолчанию 403 (разрешены только вход и выход); чувствительные GET закрыты; проверка Origin |
| уведомления | Telegram о каждом внешнем входе и о блокировке IP (не чаще раза в 10 мин на IP), журнал действий с пометкой «внешний/внутренний» |

## Что НЕ покрыто

- нет геоблокировки и списка разрешённых адресов (достаточно знать пароль и иметь телефон с кодом);
- нет защиты от распределённого подбора сверх общего лимита: он, наоборот, позволяет злоумышленнику временно закрыть внешний вход для вас (изнутри всё работает);
- нет защиты от кражи телефона вместе с паролем и кодами восстановления;
- IPv6 не слушается (nginx только на IPv4); адрес не из IPv4 считался бы внешним;
- локальный пользователь на самом сервере может подделать `X-Forwarded-For` на 127.0.0.1:7575, но он и так внутри;
- чтения (GET), доступные снаружи, показывают состояние сервера (нагрузка, диски, контейнеры, торренты, названия): это не секреты, но это информация о вашей инфраструктуре;
- сертификат `panel.pulsdev.net` продлевается тем же хуком DNS-01, что и у api.pulsdev.net; если хук сломается, через 90 дней сертификат истечёт.

## Маршруты API: что доступно снаружи

Не-GET: из 54 снаружи доступны **2** (`POST /api/auth/login`, `POST /api/auth/logout`). GET: из 53 снаружи доступны 31; закрыты чувствительные чтения (журналы, диагностика, сеть и устройства, SSH и доступ, cron, история правок, журнал действий, настройки, Wi-Fi/Bluetooth, WordPress, безопасность). Побочные эффекты у GET: только обновление времени последней активности своей сессии; `GET /api/panel-changes/job` один раз пишет итог правки в журнал (закрыт снаружи). Секретов (токенов, паролей, ключей) GET не отдают: проверено сканированием ответов; токены дополнительно маскируются перед отправкой.

| Метод | Маршрут | Снаружи |
|---|---|---|
| GET | /api/access | **нет** |
| POST | /api/access/f2b/:action | **нет** |
| POST | /api/access/keys/:action | **нет** |
| POST | /api/access/sessions/:id/kill | **нет** |
| POST | /api/access/ssh/:action | **нет** |
| POST | /api/access/ufw/:action | **нет** |
| GET | /api/adguard | да |
| POST | /api/adguard/protection | **нет** |
| POST | /api/ai/chat | **нет** |
| GET | /api/ai/settings | **нет** |
| PUT | /api/ai/settings | **нет** |
| GET | /api/ai/status | да |
| GET | /api/audit | **нет** |
| GET | /api/audit/context | **нет** |
| GET | /api/audit/facets | **нет** |
| GET | /api/audit/summary | **нет** |
| GET | /api/auth/info | да |
| POST | /api/auth/login | да |
| POST | /api/auth/logout | да |
| GET | /api/auth/me | да |
| GET | /api/backups | да |
| GET | /api/backups/ipad/job | да |
| POST | /api/backups/ipad/run | **нет** |
| GET | /api/bots | да |
| GET | /api/deadlines | да |
| PUT | /api/deadlines/config | **нет** |
| GET | /api/diagnostics | **нет** |
| GET | /api/docker | да |
| POST | /api/docker/containers/:name/:action | **нет** |
| GET | /api/exchange | да |
| GET | /api/internet | да |
| POST | /api/internet/ping | **нет** |
| DELETE | /api/internet/ping/history | **нет** |
| GET | /api/internet/ping/history | да |
| POST | /api/internet/refresh-ip | **нет** |
| GET | /api/internet/speedtest | да |
| POST | /api/internet/speedtest | **нет** |
| PUT | /api/internet/speedtest/schedule | **нет** |
| GET | /api/layout/:page | да |
| PUT | /api/layout/:page | **нет** |
| GET | /api/logs | **нет** |
| GET | /api/logs/sources | **нет** |
| GET | /api/media | да |
| GET | /api/metrics | да |
| GET | /api/metrics/names | да |
| GET | /api/network | **нет** |
| DELETE | /api/network/devices/:mac | **нет** |
| PATCH | /api/network/devices/:mac | **нет** |
| POST | /api/network/devices/:mac/scan | **нет** |
| POST | /api/network/discover | **нет** |
| PUT | /api/network/order | **нет** |
| GET | /api/notify | **нет** |
| PUT | /api/notify | **нет** |
| POST | /api/notify/check | **нет** |
| POST | /api/notify/detect-chat | **нет** |
| POST | /api/notify/test | **нет** |
| GET | /api/overview | да |
| GET | /api/panel-changes | **нет** |
| GET | /api/panel-changes/:hash | **нет** |
| GET | /api/panel-changes/backup-status | **нет** |
| GET | /api/panel-changes/job | **нет** |
| POST | /api/panel-changes/restore | **нет** |
| POST | /api/panel-changes/revert | **нет** |
| GET | /api/panel-changes/revert-candidate | **нет** |
| POST | /api/panel-changes/revert-last | **нет** |
| GET | /api/quick | да |
| GET | /api/security | **нет** |
| POST | /api/security/external | **нет** |
| POST | /api/security/sessions/:id/end | **нет** |
| POST | /api/security/sessions/end-all | **нет** |
| POST | /api/security/totp/disable | **нет** |
| POST | /api/security/totp/enable | **нет** |
| POST | /api/security/totp/recovery | **нет** |
| POST | /api/security/totp/setup | **нет** |
| GET | /api/settings/portainer | **нет** |
| PUT | /api/settings/portainer | **нет** |
| GET | /api/sites | да |
| GET | /api/sites/jetsetter/files | **нет** |
| GET | /api/sites/jetsetter/posts | **нет** |
| GET | /api/system/autostart | да |
| GET | /api/system/cron | **нет** |
| GET | /api/system/disks | да |
| GET | /api/system/disks/io | да |
| GET | /api/system/disks/io-history | да |
| POST | /api/system/disks/mount | **нет** |
| POST | /api/system/disks/smart-refresh | **нет** |
| POST | /api/system/panel/restart | **нет** |
| POST | /api/system/reboot | **нет** |
| GET | /api/system/services | да |
| POST | /api/system/services/:unit/:action | **нет** |
| GET | /api/system/snapshot | да |
| GET | /api/system/updates | да |
| GET | /api/system/updates/apt/job | да |
| POST | /api/system/updates/apt/upgrade | **нет** |
| GET | /api/telegram | да |
| GET | /api/torrents | да |
| POST | /api/torrents/:action | **нет** |
| GET | /api/uptime | да |
| GET | /api/wireless | **нет** |
| POST | /api/wireless/bluetooth/power | **нет** |
| POST | /api/wireless/bluetooth/scan | **нет** |
| POST | /api/wireless/wifi/connect | **нет** |
| POST | /api/wireless/wifi/connect-saved | **нет** |
| POST | /api/wireless/wifi/disconnect | **нет** |
| POST | /api/wireless/wifi/forget | **нет** |
| POST | /api/wireless/wifi/radio | **нет** |
| POST | /api/wireless/wifi/rescan | **нет** |
