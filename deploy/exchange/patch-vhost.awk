# Вставляет include публичной части обменника перед «location / {» в server-блоке 443 (в блоке :80 не трогает)
/^[ \t]*listen[ \t]+443/ { in443 = 1 }
/^[ \t]*listen[ \t]+80[ \t;]/ { in443 = 0 }
in443 && !done && /^[ \t]*location \/ \{/ {
    print "    include /etc/nginx/snippets/exchange-public.conf;"
    print ""
    done = 1
}
{ print }
END { if (!done) exit 3 }
