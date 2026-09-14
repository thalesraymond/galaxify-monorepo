import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { validateProxyTarget } from './src/api/proxyTarget'

/**
 * Server-only proxy targets. These variables are intentionally NOT prefixed
 * with `VITE_` so Vite never inlines them into the browser bundle. See
 * `apps/web-frontend/.env.example`.
 */
type ProxyTarget = {
  /** Browser-visible relative prefix owned by the domain-neutral transport. */
  readonly prefix: string
  /** Server-only environment variable holding the local service origin. */
  readonly envKey: string
  /** Local default matching the service ports in `docs/specs/web-frontend.md` §7. */
  readonly fallback: string
}

const proxyTargets: readonly ProxyTarget[] = [
  { prefix: '/api/user', envKey: 'USER_SERVICE_URL', fallback: 'http://localhost:8081' },
  { prefix: '/api/daily', envKey: 'DAILY_SERVICE_URL', fallback: 'http://localhost:8082' },
  { prefix: '/api/ship', envKey: 'SHIP_SERVICE_URL', fallback: 'http://localhost:8083' },
  {
    prefix: '/api/expedition',
    envKey: 'EXPEDITION_SERVICE_URL',
    fallback: 'http://localhost:8084',
  },
]

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const proxy = Object.fromEntries(
    proxyTargets.map((target) => [
      target.prefix,
      {
        target: validateProxyTarget(env[target.envKey] ?? target.fallback, target.envKey),
        changeOrigin: true,
        // The services own their domain routes; the browser prefix is stripped
        // in real mode and replaced by MSW handlers in mock mode.
        rewrite: (requestPath: string) => requestPath.replace(target.prefix, ''),
      },
    ]),
  )

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      css: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,tsx}'],
        // The exclusion list is owned by web-frontend-delivery.md §5: generated
        // contracts, declarations, configuration, test support, and fixtures.
        exclude: [
          'src/generated/**',
          '**/generated/**',
          '**/*.d.ts',
          '*.config.*',
          'vite.config.*',
          'vitest.config.*',
          'eslint.config.*',
          'playwright.config.*',
          'src/test/**',
          '**/*.test.{ts,tsx}',
          '**/*.spec.{ts,tsx}',
          'e2e/**',
          '**/fixtures/**',
          '**/mocks/**',
        ],
        thresholds: {
          lines: 70,
          statements: 70,
          functions: 70,
          branches: 60,
        },
      },
    },
  }
})
