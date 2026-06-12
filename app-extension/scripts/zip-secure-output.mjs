import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(projectDir, '.output/chrome-mv3')
const packageJsonPath = path.join(projectDir, 'package.json')
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
const zipPath = path.join(
  projectDir,
  `.output/${packageJson.name}-${packageJson.version}-chrome-secure.zip`,
)

await fs.access(outputDir)
await fs.rm(zipPath, { force: true })

await execFileAsync('zip', [
  '-r',
  '-q',
  zipPath,
  '.',
  '-x',
  '*.DS_Store',
  '-x',
  '__MACOSX/*',
], { cwd: outputDir })

const stats = await fs.stat(zipPath)
console.log(`created ${path.relative(projectDir, zipPath)} (${stats.size} bytes)`)
