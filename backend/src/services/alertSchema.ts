// Схема таблицы событий тревог. Отдельным файлом без побочных эффектов, чтобы её могли брать и db.ts (миграция), и тесты
export const ALERT_EVENTS_DDL = `
  -- Статистика обстрелов: сообщения канала, прошедшие фильтр alert_monitor (см. services/alertEvents.ts)
  CREATE TABLE alert_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                 INTEGER NOT NULL,            -- время строки лога, мс
    day                TEXT NOT NULL,               -- YYYY-MM-DD по локальному времени
    text               TEXT NOT NULL,
    categories         TEXT NOT NULL,               -- через запятую: ballistic,cruise,missile,hypersonic,aviation,drone,other
    reason             TEXT,                        -- причина срабатывания фильтра бота
    text_hash          TEXT NOT NULL UNIQUE,        -- sha1(ts + текст): дедуп
    classifier_version INTEGER NOT NULL,
    is_missile         INTEGER NOT NULL DEFAULT 0,
    ignored            INTEGER NOT NULL DEFAULT 0,  -- отбой / новостной пост — в статистику не идёт
    ignore_reason      TEXT,
    takeoff            INTEGER NOT NULL DEFAULT 0   -- сообщение о вылете носителей (Ту-95/160/22, МіГ-31К)
  );
  CREATE INDEX alert_events_ts ON alert_events (ts);
  CREATE INDEX alert_events_day ON alert_events (day);
`
