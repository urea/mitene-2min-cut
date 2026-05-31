import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const appRoot = join(scriptsDir, '..')
const sourceDir = join(appRoot, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const targetDir = join(appRoot, 'public', 'ffmpeg')

mkdirSync(targetDir, { recursive: true })

for (const fileName of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  copyFileSync(join(sourceDir, fileName), join(targetDir, fileName))
}
