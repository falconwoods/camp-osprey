import { defineConfig } from 'vite'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup/index.html'),
        options: resolve(__dirname, 'options/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/bcparks.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  plugins: [{
    name: 'copy-manifest',
    closeBundle() {
      copyFileSync('manifest.json', 'dist/manifest.json')
      mkdirSync('dist/icons', { recursive: true })
      try { copyFileSync('icons/icon48.png', 'dist/icons/icon48.png') } catch {}
      try { copyFileSync('icons/icon128.png', 'dist/icons/icon128.png') } catch {}
    },
  }],
})
