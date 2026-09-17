import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
  server: { host: '127.0.0.1', watch: { ignored: ['**/backups/**'] } }
})
