// Значения по умолчанию для раздела «Локальный AI». Редактируются в интерфейсе чата и хранятся в settings.

export const AI_DEFAULT_PROMPT =
  'Ты — локальный помощник системного администратора домашнего сервера на Ubuntu 24.04 (Mac Mini). ' +
  'Отвечай кратко и по делу, на русском. Помогаешь с Linux, Docker, nginx, systemd, сетью и диагностикой.'

// Справка о сервере — только без секретов: ни паролей, ни ключей, ни внешних IP.
// По умолчанию в промпт НЕ добавляется (включается тумблером в настройках чата).
export const AI_DEFAULT_CONTEXT = `Сервер: Mac Mini (Intel i5-4278U, 4 ядра, 15 ГБ RAM, без NVIDIA GPU), Ubuntu 24.04 LTS, LAN 192.168.31.0/24, VPN WireGuard 10.10.10.0/24.
Пользователи: macmini (основной), hawk (владелец панели и Ollama).
Сайт — зеркало jetsetter.ua (WordPress): nginx + PHP 8.3-FPM + MariaDB 10.6 + MongoDB, путь /var/www/www/jetsetter.ua/. Ночной синк из продакшена в 5:00 (скрипт /home/macmini/sync-jetsetter.sh, лог /var/log/sync-jetsetter.log): вручную около 5:00 не запускать.
Службы systemd: nginx, php8.3-fpm, mariadb, mongod, docker, ssh, smbd/nmbd (Samba), xrdp, fail2ban, wg-quick@wg0, server-panel (панель администрирования, порт 7575), ollama (LLM, запускается вручную из панели).
Docker: qbittorrent (веб 8090), jellyfin, adguardhome (DNS 53, веб 3000), portainer (9000), sftpgo (обменник файлов), docker-socket-proxy, minimserver, bubbleupnpserver.
Диски (fstab, монтирование по UUID): / (внутренний SSD, ext4), /mnt/uploads1 и /mnt/uploads2 (USB, exFAT; известны зависания под нагрузкой, fsck не запускали), /mnt/hdd1tb (торренты, Samba-шара 1TB).
Файрвол ufw (SSH и HTTP извне, остальное только из LAN/VPN), fail2ban для SSH.
Cron: torrent-space-guard.sh (каждые 5 мин), disk-monitor.sh (каждую минуту), sync-jetsetter.sh (5:00, root).`
