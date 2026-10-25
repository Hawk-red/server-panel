// Только чтение: сущности Home Assistant доменов media_player и remote — что панель может использовать для телевизора.
// Запуск: sudo -u panel node /opt/server-panel/backend/dist/scripts/list-tv-entities.js
import { config } from '../config.js'
import { errText } from '../mask.js'
import { readTvEntities, TV_SERVICES } from '../services/haClient.js'
import { FEATURE, looksLikeTv, pickEntities, planKey, supportedKeys } from '../services/tvHa.js'
import { KEYS } from '../services/tv.js'

const featureNames = (bits: number) =>
  Object.entries(FEATURE)
    .filter(([, b]) => (bits & b) === b)
    .map(([n]) => n)

try {
  const list = await readTvEntities(config.ha)
  if (list.length === 0) console.log('Сущностей media_player/remote в Home Assistant нет')
  for (const e of list) {
    console.log(`${e.entityId}`)
    console.log(`  название: ${e.name}`)
    console.log(`  состояние: ${e.state}${looksLikeTv(e) ? '   ← похоже на телевизор' : ''}`)
    if (e.entityId.startsWith('media_player.')) {
      console.log(`  supported_features: ${e.features} (${featureNames(e.features).join(', ') || 'ничего из нужного'})`)
      if (e.sourceList.length) console.log(`  источники: ${e.sourceList.join(', ')}`)
      if (e.muted !== null) console.log(`  звук выключен: ${e.muted ? 'да' : 'нет'}`)
    }
    console.log(`  панели разрешены сервисы: ${(TV_SERVICES as Record<string, readonly string[]>)[e.entityId.split('.')[0]].join(', ')}`)
    console.log()
  }
  const picked = pickEntities(list)
  console.log(`Панель возьмёт: remote=${picked.remote?.entityId ?? '—'}, media_player=${picked.media?.entityId ?? '—'}`)
  const view = { ...picked, at: Date.now() }
  const all = Object.keys(KEYS)
  const ok = supportedKeys(all, view)
  console.log(`Кнопок пульта работает: ${ok.length} из ${all.length}`)
  const grey = all.filter((k) => !planKey(k, view))
  if (grey.length) console.log(`Серыми будут: ${grey.join(', ')}`)
} catch (e) {
  console.error(errText(e))
  process.exitCode = 1
}
