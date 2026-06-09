import fs from 'node:fs/promises'
import path from 'node:path'
import JavaScriptObfuscator from 'javascript-obfuscator'

const outputDir = path.resolve('.output/chrome-mv3')

async function listJavaScriptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(fullPath)
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : []
  }))
  return files.flat()
}

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.25,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.08,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.35,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  target: 'browser',
}

const files = await listJavaScriptFiles(outputDir)

await Promise.all(files.map(async file => {
  const source = await fs.readFile(file, 'utf8')
  const result = JavaScriptObfuscator.obfuscate(source, options)
  await fs.writeFile(file, result.getObfuscatedCode(), 'utf8')
  console.log(`obfuscated ${path.relative(outputDir, file)}`)
}))
