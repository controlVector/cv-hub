import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  // Port configuration with fallbacks
  const WEB_PORT = parseInt(env.VITE_WEB_PORT || '5173', 10)
  const API_PORT = parseInt(env.VITE_API_PORT || env.API_PORT || '3000', 10)
  const PRD_API_PORT = parseInt(env.VITE_PRD_API_PORT || '8000', 10)

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@cv-hub/shared': path.resolve(__dirname, '../../packages/shared/src')
      }
    },
    server: {
      port: WEB_PORT,
      strictPort: false, // Try next available port if port is in use
      proxy: {
        '/api/prd': {
          target: `http://localhost:${PRD_API_PORT}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/prd/, '/api/v1')
        },
        '/api': {
          target: `http://localhost:${API_PORT}`,
          changeOrigin: true
        }
      }
    },
    preview: {
      port: WEB_PORT,
      strictPort: false,
    }
  }
})
