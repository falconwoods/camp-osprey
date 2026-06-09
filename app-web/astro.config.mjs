import { defineConfig } from 'astro/config';
import sitemap from "@astrojs/sitemap";
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  site: 'https://www.campsoon.com',
  integrations: [
    sitemap({
      filter: (page) => !page.endsWith('/manual-install/'),
    }),
  ],
});
