import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const proxyEnvKeys = [
  'USER_SERVICE_URL',
  'DAILY_SERVICE_URL',
  'SHIP_SERVICE_URL',
  'EXPEDITION_SERVICE_URL',
]
const defaultProxyTargets = [
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083',
  'http://localhost:8084',
]

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
