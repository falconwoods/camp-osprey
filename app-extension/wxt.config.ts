import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
  }),
  manifest: {
    name: 'campsoon',
    version: packageJson.version,
    description: 'Scan BC Parks for campsite cancellations and auto-reserve when found.',
    permissions: ['alarms', 'cookies', 'notifications', 'storage', 'tabs', 'unlimitedStorage'],
    host_permissions: ['https://camping.bcparks.ca/*'],
    externally_connectable: {
      matches: [
        'https://campsoon.com/*',
        'https://*.campsoon.com/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ],
    },
    action: {
      default_icon: {
        48: '/icons/icon48.png',
        128: '/icons/icon128.png',
      },
    },
    icons: {
      48: '/icons/icon48.png',
      128: '/icons/icon128.png',
    },
  },
})
