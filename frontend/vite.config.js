import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow access from Docker host
    port: 3000, // Keep consistent with compose mapping
    // Enable proxy for development server
    proxy: {
      // Proxy requests starting with /api to the backend service
      '/api': {
        target: 'http://backend:8000', // Target the backend service name
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/api'), // Keep /api prefix on target
      },
      // Add proxy for /webhooks if needed by frontend directly (SSE uses /api path now)
      // '/webhooks': {
      //   target: 'http://backend:8000',
      //   changeOrigin: true,
      //   secure: false,
      //   rewrite: (path) => path.replace(/^\/webhooks/, '/webhooks') 
      // }
    }
  }
}) 