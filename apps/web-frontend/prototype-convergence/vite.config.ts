import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'prototype-convergence',
  plugins: [react()],
  build: { outDir: '../dist-prototype-convergence', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4320, strictPort: true },
  preview: { host: '127.0.0.1', port: 4321, strictPort: true },
})
