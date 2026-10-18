import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/s': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // no manual chunk splitting: forcing react/mui/codemirror into static
    // chunks once caused load-order crashes in stale tabs. the Editor is
    // split naturally by its dynamic import().
    chunkSizeWarningLimit: 900,
  },
})