# Bluetooth из панели (раздел «Беспроводные»)

Два тумблера в карточке Bluetooth:

| Тумблер | Что делает |
| --- | --- |
| **Bluetooth** | включить/выключить сейчас (`bluetooth.service` запущен/остановлен) |
| **Запускать при старте сервера** | автозагрузка (`enable` / `disable`) |

Состояния согласованы: «автозагрузка включена» = `enabled`; «выключена» = `disabled` или `masked`.
Когда Bluetooth выключен и автозагрузка выключена, служба **замаскирована** (`masked`): иначе приложения по D-Bus сами её поднимали бы.

## Как это устроено (тот же паттерн, что `server-panel-docker` / `server-panel-wifi`)

* `/usr/local/sbin/server-panel-bluetooth` (root:root 0755) — принимает ровно одну команду из белого списка:
  `status`, `on`, `off`, `autostart-on`, `autostart-off`. Всё остальное — выход с кодом 2. Без shell/eval,
  строгий PATH, `flock`, журнал `/var/log/server-panel-bluetooth.log`.
* `/etc/sudoers.d/server-panel-bluetooth` (root:root 0440) — пользователю `panel` разрешены только эти пять вызовов (без `*`).
* Бэкенд: `GET /api/bluetooth/state`, `POST /api/bluetooth/power {on}`, `POST /api/bluetooth/autostart {on}` (`backend/src/routes/bluetooth.ts`,
  `services/bluetoothHelper.ts`); не чаще одного изменения в 3 секунды; каждое изменение пишется в журнал аудита (было → стало).
* Пока помощник не установлен, API отвечает 503 «хелпер не установлен, выполните install.sh», а карточка показывает плашку с инструкцией.

| Команда | Действие |
| --- | --- |
| `on` | `unmask`, `start`, `rfkill unblock bluetooth` (без `enable`) |
| `off` | `stop`; если автозагрузка не `enabled` — `mask` |
| `autostart-on` | `unmask`, `enable` |
| `autostart-off` | `disable`; если служба сейчас неактивна — `mask` |

## Установка / откат

```
sudo /opt/server-panel/deploy/bluetooth/install.sh
sudo systemctl restart server-panel     # чтобы панель подхватила новые маршруты
sudo /opt/server-panel/deploy/bluetooth/rollback.sh
```

Установка состояние Bluetooth не меняет. Тесты помощника: `python3 -I deploy/bluetooth/test_helper.py`.

## Проверка

```
sudo -u panel sudo -n /usr/local/sbin/server-panel-bluetooth status      # JSON
sudo -u panel sudo -n /usr/local/sbin/server-panel-bluetooth restart     # должно отказать
systemctl is-active bluetooth; systemctl is-enabled bluetooth
sudo tail /var/log/server-panel-bluetooth.log
```

## Вернуть masked (как было до тумблеров)

```
sudo systemctl stop bluetooth && sudo systemctl mask bluetooth
```
