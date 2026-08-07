import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://topcoders.dev',
  trailingSlash: 'never',
  build: { format: 'file' },
})
