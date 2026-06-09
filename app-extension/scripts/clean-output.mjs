import fs from 'node:fs/promises'
import path from 'node:path'

await fs.rm(path.resolve('.output/chrome-mv3'), { recursive: true, force: true })
