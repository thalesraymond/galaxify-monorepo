import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'prototype-identity',
  plugins: [react()],
  build: { outDir: '../dist-prototype-identity', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4318, strictPort: true },
  preview: { host: '127.0.0.1', port: 4319, strictPort: true },
})
