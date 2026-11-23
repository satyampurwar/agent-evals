/**
 * Vite config for the Vue UI.
 * Dev: browser calls `/api/...`; proxy strips `/api` and forwards to the Nest API
 * (no CORS). Production nginx image does the same (see apps/web/Dockerfile).
 */
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const apiTarget = process.env.API_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
