# Панель сервера Mac Mini

Веб-панель администрирования домашнего сервера (Ubuntu 24.04, Mac Mini). ТЗ — `~/PANEL_SPEC.md`.

- **Адрес:** `http://192.168.31.112:7575` (дома) или `http://10.10.10.1:7575` (через WireGuard).
- **Доступ** только из `192.168.31.0/24`, `10.10.10.0/24` и localhost. Работают два рубежа:
  - в ufw порт 7575 открыт только для этих сетей;
  - бэкенд сам отклоняет запросы из других сетей и отвечает 403.
- **Вход** по одному паролю. Сессия хранится в cookie (httpOnly, SameSite=Strict) 30 дней. После 5 неудачных попыток за 15 минут вход с этого IP блокируется.

## Устройство

```
/opt/server-panel/
├── frontend/   shadcn-admin (React 19 + Vite + TanStack Router + Tailwind 4), собирается в frontend/dist
├── backend/    Fastify + TypeScript: API /api/* и раздача frontend/dist на одном порту 7575
│   ├── .env    секреты (600, владелец panel) — в git не входит
│   └── src/    collector/ (метрики), system/, services/, network/, routes/
├── data/       SQLite panel.db (750, владелец panel): метрики, устройства, журнал действий, сессии
└── deploy/     systemd-юнит, sudoers, server-panel-helper, docker-socket-proxy, update.sh
```

- Панель **не зависит от nginx**: её не выключает кнопка «остановить nginx».
- **Служба:** `server-panel.service` работает от системного пользователя `panel`, лимиты памяти `MemoryHigh=150M` и `MemoryMax=250M`. В покое занимает около 40 МБ cgroup и около 85 МБ RSS.
- **Коллектор метрик.** Опрос раз в 30 с. Каждый источник (CPU, температура, SMART, qBittorrent, AdGuard, сеть…) обёрнут в свой `try/catch`: если источник недоступен, в интерфейсе будет «нет данных», а не ошибка.
- **Хранение метрик:**
  - сырые данные — 48 ч;
  - средние по 5 мин — 14 дней;
  - средние по часу — 400 дней.
- **Журнал действий** хранится год.

## Права: что и через что

| Что | Как |
|---|---|
| Логи `/var/log`, журнал systemd | группы `adm`, `systemd-journal` |
| `/home/hawk/disk-monitor.log` | ACL: `panel` — проход в `/home/hawk` и чтение файла |
| `/opt/alert_monitor/config.json` (имя бота) | группа `panel`, права 640 |
| Docker | **без группы docker**, только через `docker-socket-proxy` на `127.0.0.1:2375` (GET containers/info/images/version, логи, POST start/stop/restart; create/exec/delete запрещены) |
| SMART, чтение crontab, start/stop/restart 15 служб, размер querylog AdGuard, WP-CLI (от www-data, одна команда) | `/etc/sudoers.d/server-panel` — только конкретные команды |
| Ключи SSH, ufw deny, fail2ban, завершение сессий, ssh stop/start, `wg show`, arp-scan | `/usr/local/sbin/server-panel-helper` (root:root 755) — сам проверяет каждую команду и аргумент |

Исходники sudoers и helper лежат в `deploy/`. Установленные копии должны с ними совпадать:

```bash
sudo cmp /opt/server-panel/deploy/server-panel-helper /usr/local/sbin/server-panel-helper
sudo cmp /opt/server-panel/deploy/sudoers-server-panel /etc/sudoers.d/server-panel
```

## Как запустить, остановить, посмотреть логи

```bash
systemctl status server-panel
sudo systemctl restart server-panel
journalctl -u server-panel -f          # или в самой панели: Система → Логи → «Панель»
```

## Как обновить после правок кода

```bash
/opt/server-panel/deploy/update.sh      # сборка backend + frontend (от hawk)
sudo systemctl restart server-panel     # нужен только при изменениях бэкенда
```

Фронт отдаётся с диска при каждом запросе, поэтому после пересборки он подхватывается без перезапуска.

Если меняли `deploy/sudoers-server-panel` или `deploy/server-panel-helper`, их нужно установить заново:

```bash
sudo visudo -cf /opt/server-panel/deploy/sudoers-server-panel && sudo install -o root -g root -m 440 /opt/server-panel/deploy/sudoers-server-panel /etc/sudoers.d/server-panel
sudo install -o root -g root -m 755 /opt/server-panel/deploy/server-panel-helper /usr/local/sbin/server-panel-helper
```

## Как сменить пароль панели

```bash
sudo -u panel node /opt/server-panel/backend/dist/scripts/set-password.js
sudo systemctl restart server-panel
```

Хэш argon2id записывается в `backend/.env`. Пароль — минимум 10 символов. Уже открытые сессии продолжают действовать. Чтобы завершить их все, остановите службу и удалите строки из таблицы `sessions`, либо просто нажмите «Выйти» на каждом устройстве.

## Секреты (логины сервисов)

```bash
sudo -u panel node /opt/server-panel/backend/dist/scripts/set-secret.js QBT_USER        # и QBT_PASSWORD
sudo -u panel node /opt/server-panel/backend/dist/scripts/set-secret.js ADGUARD_USER    # и ADGUARD_PASSWORD
sudo -u panel node /opt/server-panel/backend/dist/scripts/set-secret.js JELLYFIN_API_KEY
sudo systemctl restart server-panel
```

Ввод скрыт, значения хранятся только в `.env`. На фронт секреты никогда не уходят.

## docker-socket-proxy

```bash
cd /opt/server-panel/deploy/docker-socket-proxy && docker compose up -d      # от hawk (он в группе docker)
```

Панель сама этот контейнер не останавливает: без него она потеряет доступ к Docker.

## Иконки сервисов

Иконки из [dashboard-icons](https://github.com/walkxcode/dashboard-icons) лежат в `frontend/public/icons`, в рантайме ничего не качается. Добавить новую иконку: вписать slug в `frontend/scripts/icons.json`, затем выполнить `cd frontend && npm run fetch-icons && npm run build`.

## Разделы

- **Обзор** — плитки, диски, сводка, список проблем.
- **Система** — графики за час / сутки / неделю / месяц / 3 месяца, диски и SMART, cron и таймеры, автозагрузка, службы, единый просмотр логов.
- **Медиа** — Jellyfin (с сессиями), MinimServer, BubbleUPnP, Marantz.
- **Торренты** — qBittorrent: скорость, статистика, активные торренты, состояние `torrent-space-guard`.
- **AdGuard Home** — защита, статистика, почасовая история, размер журнала запросов.
- **Docker** — контейнеры, образы, compose-стеки.
- **Сайты и API** — зеркало jetsetter (стек, синк, WP-CLI, изменения), pulsdev-api (health, срок сертификата), File Browser.
- **Telegram-боты** — Air Alert Monitor и бот заявок pulsdev.
- **SSH и доступ** — ключи, сессии, fail2ban, ufw, RDP/VNC, WireGuard.
- **Сеть и устройства** — сканер 192.168.31.0/24: nmap + ARP + arp-scan раз в 5 мин, порты по кнопке и ночью в 03:30.
- **Журнал действий** — все действия из панели с фильтрами.
- **Бэкапы** — свежесть и размер: дамп БД синка, prod-code-backup, снимки iPad, разовые копии «перед обновлением»; порог возраста 36 ч (iPad — 48 ч), при просрочке — уведомление в Telegram.
- **Интернет** — пинг до 1.1.1.1 и 8.8.8.8 раз в 30 с, внешний IP (api.ipify.org), история обрывов; «нет связи» — когда не отвечают оба адреса. Уведомление об обрыве > 5 мин уходит после восстановления связи.
- **Сайты и API → Обменник** — состояние SFTPGo, ссылки, место, последние загрузки; установка — `deploy/exchange/install.sh`.
- **Обзор** — карточки «Быстрые действия» (перезапуск qBittorrent, пауза торрентов, AdGuard off на 10 мин, всё с подтверждением) и «Сроки» (сертификат, домены через RDAP, свои даты).

## HTTPS: https://panel.pulsdev.net

Панель за nginx (`deploy/panel-https/`): виртуальный хост `panel.pulsdev.net` на 443 и 9443 (один адрес `https://panel.pulsdev.net:9443` для дома и мира) → `127.0.0.1:7575`, **доступ только из 192.168.31.0/24, 10.10.10.0/24 и 127.0.0.1** (`allow/deny` на уровне server; через проброс 9443 из интернета — 403). Имя резолвится в LAN записью DNS-rewrite в AdGuard (`deploy/exchange/adguard-rewrite.py --domain panel.pulsdev.net`). Сертификат отдельный, DNS-01 тем же хуком, что у api.pulsdev.net; общий deploy-hook перечитывает nginx после продления.

Установка: `sudo deploy/panel-https/install.sh`, проверка: `deploy/panel-https/verify.sh`. Откат: `sudo rm /etc/nginx/sites-enabled/panel.pulsdev.net && sudo nginx -t && sudo systemctl reload nginx` (панель продолжит работать по `http://192.168.31.112:7575`).

Панель верит заголовкам `X-Forwarded-*` только от соединений с 127.0.0.1 (`trustProxy`): в журнале и блокировках настоящий адрес клиента. Cookie сессии получает `Secure`, когда запрос пришёл по HTTPS; вход по `http://` в LAN работает как раньше.

## Ссылки на веб-интерфейсы служб

Адреса qBittorrent, AdGuard, Portainer, Jellyfin, зеркала сайта, Marantz и т. д. не строятся из адреса страницы (панель открывается и по `https://panel.pulsdev.net:9443`, где портов служб нет, а HSTS принудительно меняет http на https). Их отдаёт сервер: `GET /api/links` (реестр `backend/src/services/links.ts`, адрес сервера в LAN — переменная `LAN_HOST` в `backend/.env`, по умолчанию `192.168.31.112`). Схема у каждой службы своя (все отвечают по http, админка SFTPGo — https). Снаружи адреса не отдаются, ссылки неактивны с подсказкой «Доступно только из домашней сети или через WireGuard». Новая служба: строка в реестре и `<HomeLink service='id'>`.

## Доступ из интернета (подготовлен, выключен)

2FA (TOTP), блокировки по IP, запрет опасных действий снаружи, лимиты nginx, fail2ban и скрипты открытия/закрытия — в `deploy/panel-https/`, описание и порядок включения — `deploy/panel-https/EXTERNAL-ACCESS.md`. Раздел панели «Безопасность»: 2FA, выключатель «Доступ из интернета», активные сессии. Пока вы не запустите `open-external.sh` и не включите выключатель, снаружи по-прежнему 403.

## Обменник файлов (SFTPGo)

Файлы для людей вне сети. Гости открывают `https://api.pulsdev.net:9443/files/`, из дома — `https://api.pulsdev.net/files/`. Пользователи, папки и права — в **админке** `https://api.pulsdev.net:8443/files/web/admin/`: она открывается только из домашней сети и VPN. Установка — `sudo deploy/exchange/install.sh`, обновление образа — `sudo deploy/exchange/update.sh` (пересобирает и русский перевод веб-клиента). Порты и включённые протоколы задаются в `/opt/sftpgo/compose.yaml`, в веб-интерфейсе их нет.

**Готовые пользователи** (создаёт `~/Scripts/exchange-users.py`): `admin` — весь обменник, квота 25 ГБ (в неё входят и гостевые папки); `uploads` — гость: только список, загрузка и создание папок, квота 20 ГБ. Файл — не больше 10 ГБ. Раз в час SFTPGo пересчитывает занятое место, поэтому квота `admin` учитывает загрузки гостей с задержкой до часа.

**Как добавить нового гостя со своей папкой** (админка, английский интерфейс с русскими подписями «Имя пользователя», «Пароль»):

1. **Users** → у строки `uploads` меню **Действия** → **Use as a template**: форма откроется уже с нужными правами и лимитами. (Можно и **Добавить** с нуля — тогда пройдите пункты 3–6.)
2. Введите **Имя пользователя** (например `ivan`) и **Пароль** — не короче 12 символов.
3. **File system → Root directory**: `/data/exchange/ivan`. Папка создастся сама; `admin` увидит её рядом с `uploads`.
4. **ACLs → Permissions**: оставьте только `list`, `upload`, `create_dirs` (звёздочку `*` и остальное снимите). Скачивание не включайте: под одним логином бывает несколько людей.
5. **ACLs → Denied protocols**: отметьте `SSH`, `FTP`, `DAV` (`HTTP` не отмечайте, иначе вход в веб-клиент закроется). **Web client/REST API**: отметьте `shares-disabled`, `password-change-disabled`, `api-key-auth-change-disabled`, `publickey-change-disabled`, `tls-cert-change-disabled`, `mfa-disabled`, `info-change-disabled`, `password-reset-disabled`.
6. **Disk quota and bandwidth limits**: **Quota size** — например `10GB`, **Max upload size** — `5GB` (суффиксы MB/GB/TB работают).
7. **Сохранить**, затем проверьте вход на `https://api.pulsdev.net:9443/files/`. Пароль передайте человеку лично.

Панель присылает в Telegram сообщение о загрузке любого гостя (все пользователи, кроме `admin`): имя файла, размер и IP. Отключить гостя — Users → **Изменить** → **Профиль** → Status: Inactive. Забаненные за подбор пароля адреса видны в админке (IP Manager → IP Lists) и в `fail2ban-client status exchange`.

## Если что-то не так

| Симптом | Что проверить |
|---|---|
| Пустая страница | `journalctl -u server-panel -n 50`; убедиться, что `frontend/dist` собран |
| «нет данных» в разделе | всплывающая подсказка у «нет данных» показывает причину (нет прав, не задан секрет, сервис не отвечает) |
| «нет прав (sudoers)» | установленный sudoers или helper не совпадает с `deploy/` (см. `cmp` выше) |
| Docker «нет данных» | `docker ps --filter name=docker-socket-proxy` |
| Не пускает с правильным паролем | лимит 5 попыток за 15 мин с одного IP — подождать или войти с другого устройства |
