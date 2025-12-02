import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/BioProject/',
  server: {
    port: 3000,
    watch: {
      // Exclude Data folder from watching to improve performance
      ignored: ['**/Data/**', '**/downloadData/**']
    },
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
