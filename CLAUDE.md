# Project Context: Server Panel

## Архитектура проекта
- **Backend**: Node.js / TypeScript (папка `/opt/server-panel/backend/`)
- **Frontend**: React + Vite + TailwindCSS (папка `/opt/server-panel/frontend/`)
- **Главная страница медиа/пульта**: `/opt/server-panel/frontend/src/features/media-hub/index.tsx`
- **Компонент "Пульт" (Универсальный)**: `/opt/server-panel/frontend/src/features/universal/index.tsx`
- **Общий компонент шапки (Page)**: `/opt/server-panel/frontend/src/components/layout/page.tsx`
- **Контекст редактирования**: `/opt/server-panel/frontend/src/components/layout/layout-edit.tsx`

## Правила работы
1. **Frontend**: Используй Tailwind. Для выравнивания элементов применяй `flex items-center justify-between w-full`.
2. **Тесты**: Всегда обновляй тесты в `*.test.ts(x)`, если меняешь логику компонентов.
3. **Проверка**: После правок всегда запускай `cd /opt/server-panel/frontend && npm run lint && npm test && npm run build`.
4. **Защита**: Избегай полной перезаписи файлов (Write), используй точечные правки (Update), чтобы не триггерить защиту Auto Mode.

## Что НЕ нужно трогать
- WordPress / nginx / сайт jetsetter.ua (это отдельный проект, не имеющий отношения к этой панели).
