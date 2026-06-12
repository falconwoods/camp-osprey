import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JavaScriptObfuscator from 'javascript-obfuscator'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(projectDir, '.output/chrome-mv3')

async function listJavaScriptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(fullPath)
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : []
  }))
  return files.flat()
}

async function listSourceMapFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSourceMapFiles(fullPath)
    return entry.isFile() && entry.name.endsWith('.map') ? [fullPath] : []
  }))
  return files.flat()
}

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.45,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.12,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  renameProperties: false,
  sourceMap: false,
  selfDefending: false,
  simplify: true,
  debugProtection: false,
  disableConsoleOutput: false,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayEncoding: ['base64'],
  stringArrayIndexesType: ['hexadecimal-number'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: true,
  target: 'browser-no-eval',
}

await fs.access(outputDir)

const sourceMapFiles = await listSourceMapFiles(outputDir)
await Promise.all(sourceMapFiles.map(file => fs.rm(file, { force: true })))

const files = await listJavaScriptFiles(outputDir)

let totalInputBytes = 0
let totalOutputBytes = 0

for (const file of files) {
  const source = await fs.readFile(file, 'utf8')
  totalInputBytes += Buffer.byteLength(source)
  const result = JavaScriptObfuscator.obfuscate(source, options)
  const obfuscatedCode = result.getObfuscatedCode()
  totalOutputBytes += Buffer.byteLength(obfuscatedCode)
  await fs.writeFile(file, obfuscatedCode, 'utf8')
  console.log(`obfuscated ${path.relative(outputDir, file)}`)
}

if (sourceMapFiles.length > 0) {
  console.log(`removed ${sourceMapFiles.length} source map file(s)`)
}

console.log(`obfuscated ${files.length} file(s): ${totalInputBytes} -> ${totalOutputBytes} bytes`)
