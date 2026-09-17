import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { parseProxyEnvironment } from './src/api/proxyTarget'
import { parseMockScenario } from './src/mocks/scenarios'

/**
 * Browser-visible relative prefixes owned by the domain-neutral transport.
 * Server-only origins are validated from the environment at Vite's trust
 * boundary; see `apps/web-frontend/.env.example` and
 * `docs/specs/web-frontend.md` §7. Mock mode skips the proxy entirely because
 * MSW intercepts the same `/api/{service}` paths in the browser.
 */
const proxyPrefixes = {
  '/api/user': 'USER_SERVICE_PROXY_TARGET',
  '/api/daily': 'DAILY_SERVICE_PROXY_TARGET',
  '/api/ship': 'SHIP_SERVICE_PROXY_TARGET',
  '/api/expedition': 'EXPEDITION_SERVICE_PROXY_TARGET',
} as const

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  // Invalid scenario names fail `npm run dev:mock` before the server starts and
  // list the valid names (issue #136, "Environment contract").
  if (mode === 'mock') {
    parseMockScenario(environment.VITE_MOCK_SCENARIO)
  }

  const proxyEnvironment = mode === 'mock' ? undefined : parseProxyEnvironment(environment)

  const proxy =
    proxyEnvironment === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(proxyPrefixes).map(([prefix, envKey]) => [
            prefix,
            {
              target: proxyEnvironment[envKey],
              changeOrigin: true,
              // The services own their domain routes; the browser prefix is
              // stripped in real mode and replaced by MSW handlers in mock mode.
              rewrite: (requestPath: string) => requestPath.replace(prefix, ''),
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
      ...(proxy === undefined ? {} : { proxy }),
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      // `perf:dashboard` deliberately measures the production build while
      // signing up through the real services, so preview must preserve the
      // same server-only relative `/api/{service}` proxy boundary as dev.
      ...(proxy === undefined ? {} : { proxy }),
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
