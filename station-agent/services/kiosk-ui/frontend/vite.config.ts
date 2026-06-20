import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5007',
        changeOrigin: true,
      },
      '/hubs': {
        target: 'ws://localhost:5007',
        ws: true,
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: '../src/ND.KioskUi.Api/wwwroot',
    emptyOutDir: true,
  }
})
