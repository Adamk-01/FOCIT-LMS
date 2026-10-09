import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Bind to all interfaces so Docker port mapping works
    port: 5173,
    proxy: {
      '/api': {
        // Docker internal DNS resolves 'bff' to the Express container's IP
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
