import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://top-coders.vercel.app',
  trailingSlash: 'never',
  build: { format: 'file' },
})
