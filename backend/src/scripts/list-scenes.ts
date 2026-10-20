import { config } from '../config.js'
import { errText } from '../mask.js'
import { readScenes } from '../services/haClient.js'

// Показывает сцены Home Assistant: только entity_id и название (чтение). Запуск: sudo -u panel node dist/scripts/list-scenes.js
try {
  const list = await readScenes(config.ha)
  if (list.length === 0) console.log('Сцен (scene.*) в Home Assistant нет')
  for (const s of list) console.log(`${s.entityId}\t${s.name}`)
} catch (e) {
  console.error(errText(e))
  process.exitCode = 1
}
