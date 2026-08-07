import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://top-coders-chi.vercel.app',
  trailingSlash: 'never',
  // format 'directory' (el default) sirve /peru desde peru/index.html, que
  // cualquier host estático resuelve sin configuración extra.
})
