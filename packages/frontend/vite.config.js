import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_TARGET || process.env.VITE_API_TARGET || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0', // Bind to all interfaces so Docker port mapping works
      port: 5180,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        }
      }
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('pdfjs-dist') || id.includes('react-pdf')) {
              return 'vendor-pdf';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('node_modules/@tanstack')) {
              return 'vendor-query';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
              return 'vendor-react';
            }
          }
        }
      }
    }
  };
});
