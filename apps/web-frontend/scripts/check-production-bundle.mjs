import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const proxyEnvKeys = [
  'USER_SERVICE_PROXY_TARGET',
  'DAILY_SERVICE_PROXY_TARGET',
  'SHIP_SERVICE_PROXY_TARGET',
  'EXPEDITION_SERVICE_PROXY_TARGET',
]
const defaultProxyTargets = [
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083',
  'http://localhost:8084',
]

// Phase 1 compressed-JavaScript budgets (web-frontend-delivery.md §8): the
// initial payload must stay at or under 200 KiB gzip and every lazy route
// chunk must stay at or under 150 KiB gzip.
const INITIAL_JS_BUDGET_BYTES = 200 * 1024
const ROUTE_CHUNK_BUDGET_BYTES = 150 * 1024

const configuredProxyTargets = await readConfiguredProxyTargets()
const forbiddenValues = [
  ...proxyEnvKeys.map((key) => [key, key]),
  ...defaultProxyTargets.map((target) => ['default proxy target', target]),
  ...configuredProxyTargets,
]
const bundle = await readDirectory(resolve('dist'))

for (const [label, value] of forbiddenValues) {
  if (bundle.includes(value)) {
    throw new Error(`Production bundle contains ${label}`)
  }
}

console.log('Production bundle contains no proxy configuration or proxy target values.')

await assertCompressedJavaScriptBudgets()

/**
 * Enforces the §8 budgets: the JavaScript referenced by `dist/index.html`
 * (the initial payload a Player downloads before any route loads) must total
 * at most 200 KiB gzip, and every other JavaScript asset — the lazy route
 * chunks — at most 150 KiB gzip each. Sizes use maximum-level gzip, the
 * most conservative common gzip output, so any pass is reproducible.
 */
async function assertCompressedJavaScriptBudgets() {
  const html = await readFile(resolve('dist/index.html'), 'utf8')
  const initialScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])
  if (initialScripts.length === 0) {
    throw new Error('dist/index.html references no JavaScript; nothing to budget')
  }

  const assets = await readdir(resolve('dist/assets'))
  const javascriptAssets = assets.filter((name) => name.endsWith('.js'))
  const initialNames = initialScripts.map((src) => src.replace(/^\/assets\//, ''))
  const routeChunkNames = javascriptAssets.filter((name) => !initialNames.includes(name))

  let initialBytes = 0
  for (const name of initialNames) {
    const content = await readFile(resolve('dist/assets', name))
    initialBytes += gzipSync(content, { level: 9 }).length
  }
  if (initialBytes > INITIAL_JS_BUDGET_BYTES) {
    throw new Error(
      `Initial JavaScript is ${formatKiB(initialBytes)} gzip, over the ${formatKiB(INITIAL_JS_BUDGET_BYTES)} budget (web-frontend-delivery.md §8)`,
    )
  }
  console.log(
    `Initial JavaScript: ${formatKiB(initialBytes)} gzip (budget ${formatKiB(INITIAL_JS_BUDGET_BYTES)}).`,
  )

  for (const name of routeChunkNames) {
    const content = await readFile(resolve('dist/assets', name))
    const bytes = gzipSync(content, { level: 9 }).length
    if (bytes > ROUTE_CHUNK_BUDGET_BYTES) {
      throw new Error(
        `Route chunk ${name} is ${formatKiB(bytes)} gzip, over the ${formatKiB(ROUTE_CHUNK_BUDGET_BYTES)} budget (web-frontend-delivery.md §8)`,
      )
    }
  }
  const largest = await largestRouteChunk(routeChunkNames)
  console.log(
    `Lazy route chunks: ${routeChunkNames.length} files, largest ${largest === undefined ? '—' : `${largest.name} at ${formatKiB(largest.bytes)} gzip`} (budget ${formatKiB(ROUTE_CHUNK_BUDGET_BYTES)} each).`,
  )
}

async function largestRouteChunk(names) {
  let largest
  for (const name of names) {
    const content = await readFile(resolve('dist/assets', name))
    const bytes = gzipSync(content, { level: 9 }).length
    if (largest === undefined || bytes > largest.bytes) {
      largest = { name, bytes }
    }
  }
  return largest
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

async function readConfiguredProxyTargets() {
  const values = []
  for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try {
      const content = await readFile(filename, 'utf8')
      for (const line of content.split('\n')) {
        const [key, ...rawValue] = line.split('=')
        if (key !== undefined && proxyEnvKeys.includes(key) && rawValue.length > 0) {
          const value = rawValue
            .join('=')
            .trim()
            .replace(/^['"]|['"]$/g, '')
          if (value !== '') {
            values.push([key, value])
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }
  return values
}

async function readDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? readDirectory(path) : readFile(path, 'utf8')
    }),
  )
  return contents.join('')
}
