#!/bin/bash
# Проверка https://panel.pulsdev.net после install.sh. Запуск: /opt/server-panel/deploy/panel-https/verify.sh (sudo нужен только для nginx -T)
H=panel.pulsdev.net
echo "== 1. Имя резолвится на сервере"; getent hosts $H || echo "НЕ резолвится (нужна запись в AdGuard / у регистратора)"
echo "== 2. HTTPS через --resolve на 127.0.0.1 (ожидается 200)"
curl -sI --resolve $H:443:127.0.0.1 https://$H/ | head -1
echo "== 3. Заголовки"; curl -sI --resolve $H:443:127.0.0.1 https://$H/ | grep -iE "strict-transport|x-content-type|referrer"
echo "== 4. Подмена X-Forwarded-For не обходит allow (с 127.0.0.1 доступ разрешён, а заголовок игнорируется)"
curl -s -o /dev/null -w "   запрос с поддельным XFF: %{http_code}\n" --resolve $H:443:127.0.0.1 -H "X-Forwarded-For: 8.8.8.8" https://$H/
echo "== 5. Блок deny/allow в боевой конфигурации (нужен sudo)"
sudo nginx -T 2>/dev/null | awk '/server_name panel.pulsdev.net/{f=1} f&&/(allow|deny|realip)/{print NR": "$0} f&&/^}/{n++} n>=2{exit}'
echo "   (set_real_ip_from / real_ip_header в конфигурации): $(sudo nginx -T 2>/dev/null | grep -c 'real_ip')"
echo "== 6. Остальные хосты работают"
curl -sk -o /dev/null -w "   api.pulsdev.net /health: %{http_code}\n" --resolve api.pulsdev.net:443:127.0.0.1 https://api.pulsdev.net/health
curl -sk -o /dev/null -w "   api.pulsdev.net /files/: %{http_code}\n" --resolve api.pulsdev.net:443:127.0.0.1 https://api.pulsdev.net/files/
curl -s -o /dev/null -w "   jetsetter (http, default): %{http_code}\n" http://127.0.0.1/
