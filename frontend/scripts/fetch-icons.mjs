// Одноразовая загрузка иконок dashboard-icons в public/icons (SVG, если есть, иначе PNG).
// В рантайме панель ничего не грузит извне.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const BASE = 'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main'
const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'public', 'icons')
const { slugs } = JSON.parse(await readFile(path.join(import.meta.dirname, 'icons.json'), 'utf8'))
const force = process.argv.includes('--force')

await mkdir(outDir, { recursive: true })
const manifest = {}
for (const slug of slugs) {
  let saved = null
  for (const ext of ['svg', 'png']) {
    const file = path.join(outDir, `${slug}.${ext}`)
    if (!force && existsSync(file)) {
      saved = ext
      break
    }
    const res = await fetch(`${BASE}/${ext}/${slug}.${ext}`)
    if (!res.ok) continue
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    saved = ext
    break
  }
  manifest[slug] = saved
  console.log(saved ? `✓ ${slug}.${saved}` : `✗ ${slug}: нет в dashboard-icons`)
}
await writeFile(path.join(root, 'src', 'lib', 'icons.gen.json'), JSON.stringify(manifest, null, 2) + '\n')
