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
    rollupOptions: {
      output: {
        // vendor chunks change rarely, so app updates stay a small download
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          // syntax grammars are only pulled in by the lazy Editor import
          codemirror: [
            '@uiw/react-codemirror',
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/language',
            '@codemirror/commands',
            '@codemirror/autocomplete',
            '@codemirror/search',
            '@codemirror/lang-html',
            '@codemirror/lang-css',
            '@codemirror/lang-javascript',
            '@codemirror/lang-json',
            '@codemirror/lang-markdown',
            '@codemirror/lang-rust',
            '@codemirror/lang-python',
            '@codemirror/lang-sql',
            '@codemirror/lang-xml',
            '@codemirror/lang-yaml',
            '@codemirror/theme-one-dark',
          ],
        },
      },
    },
  },
})