import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 3000,
    // The watcher is disabled because this project lives on a Google Drive mount,
    // where the file watcher (chokidar) crawls the tree and crashes the dev server
    // with ETIMEDOUT when a Drive read times out. Disabling it loses hot-reload
    // (refresh the browser manually after edits) but keeps the server stable.
    // For full HMR, run from local disk instead.
    watch: null,
    fs: {
      // Allow serving files from Data directory if needed
      strict: false
    }
  },
  optimizeDeps: {
    include: ['three']
  },
  build: {
    // Improve build performance
    chunkSizeWarningLimit: 1000
  }
})
