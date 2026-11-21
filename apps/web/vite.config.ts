import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The API has no CORS. In dev, the browser calls /api/... and Vite forwards it to the Nest API,
// so the API's paths (/tasks, /configs, ...) never collide with the UI's own routes.
const apiTarget = process.env.API_URL ?? 'http://localhost:3000'

// https://vite.dev/config/
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
