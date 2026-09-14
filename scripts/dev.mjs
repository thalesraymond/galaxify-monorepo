#!/usr/bin/env node
/**
 * Repository-owned real-stack supervisor (issue #136 resolution, "Real-stack
 * orchestration"). Starts healthy infrastructure, migrations, User Service,
 * the remaining services, workers, and Vite in bounded healthy order.
 *
 *   node scripts/dev.mjs            # full real stack (make dev)
 *   node scripts/dev.mjs --infra    # PostgreSQL + RabbitMQ only (make dev-infra)
 *   node scripts/dev.mjs --down     # stop app children + infrastructure (make dev-down)
 *   node scripts/dev.mjs --reset    # destroy volumes, restart infra, migrate (make dev-reset)
 *
 * Not a global process supervisor: it owns only the children it starts and
 * cleans them up on interruption. Normal shutdown preserves Docker data.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Services started after infrastructure, in dependency order. */
export const serviceDefinitions = [
  {
    name: 'user-service',
    dir: 'apps/user-service',
    port: 8081,
    databaseUrl: 'postgres://postgres:password@localhost:5431/user_db',
    migrationDir: 'sql/schema',
  },
  {
    name: 'daily-service',
    dir: 'apps/daily-service',
    port: 8082,
    databaseUrl: 'postgres://postgres:password@localhost:5432/daily_db',
    migrationDir: 'sql/schema',
  },
  {
    name: 'ship-service',
    dir: 'apps/ship-service',
    port: 8083,
    databaseUrl: 'postgres://postgres:password@localhost:5433/ship_db',
    migrationDir: 'sql/schema',
  },
  {
    name: 'expedition-service',
    dir: 'apps/expedition-service',
    port: 8084,
    databaseUrl: 'postgres://postgres:password@localhost:5434/expedition_db',
    migrationDir: 'sql/schema',
  },
]

export const workerDefinitions = [
  { name: 'daily-cron', dir: 'workers/daily-cron' },
  { name: 'expedition-worker', dir: 'workers/expedition-worker' },
]

export const apiPorts = serviceDefinitions.map((service) => service.port)
export const vitePort = 5173
export const infrastructurePorts = [5431, 5432, 5433, 5434, 5672, 15672]
export const pidFile = join(repoRoot, '.dev', 'pids.json')

const HEALTH_TIMEOUT_MS = 30_000
const VITE_TIMEOUT_MS = 60_000
const INFRA_TIMEOUT_MS = 180_000

/**
 * Parses the single supervisor mode flag. `--no-infra` attaches to
 * already-healthy infrastructure (parallel worktrees, CI, or a stack already
 * started with `make dev-infra`).
 */
export function parseSupervisorArgs(argv) {
  const flags = argv.filter((argument) => argument.startsWith('--'))
  if (flags.length > 1) {
    throw new Error(`Expected at most one option, received: ${flags.join(', ')}`)
  }
  switch (flags[0]) {
    case undefined:
      return 'dev'
    case '--no-infra':
      return 'dev-no-infra'
    case '--infra':
      return 'infra'
    case '--down':
      return 'down'
    case '--reset':
      return 'reset'
    default:
      throw new Error(`Unknown option ${flags[0]}. Use --infra, --no-infra, --down, or --reset.`)
  }
}

export function formatLogLine(name, line) {
  return `[${name}] ${line}`
}

/** Redacts credentials, tokens, and refresh secrets from streamed logs. */
export function redactSecrets(line) {
  return line
    .replace(/((?:postgres|postgresql):\/\/[^:@/\s]+):[^@/\s]+@/gi, '$1:****@')
    .replace(/(amqps?:\/\/[^:@/\s]+):[^@/\s]+@/gi, '$1:****@')
    .replace(/(password["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1****')
    .replace(/(Authorization:\s*Bearer\s+)\S+/gi, '$1****')
    .replace(/(refresh_token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1****')
}

export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolvePort) => {
    const server = createServer()
    server.once('error', () => resolvePort(false))
    server.once('listening', () => {
      server.close(() => resolvePort(true))
    })
    server.listen(port, host)
  })
}

export async function assertPortsFree(ports, probe = isPortFree) {
  const occupied = []
  for (const port of ports) {
    if (!(await probe(port))) {
      occupied.push(port)
    }
  }
  if (occupied.length > 0) {
    throw new Error(
      `Port(s) ${occupied.join(', ')} are already in use. ` +
        'Run `make dev-down` first, or stop the process holding the port.',
    )
  }
}

/** Resolves once a TCP port accepts a connection or rejects at the timeout. */
export function waitForPort(
  port,
  { timeoutMs = INFRA_TIMEOUT_MS, intervalMs = 500, host = '127.0.0.1' } = {},
) {
  return new Promise((resolvePort, rejectPort) => {
    const deadline = Date.now() + timeoutMs
    const attempt = () => {
      const socket = createConnection({ port, host })
      socket.once('connect', () => {
        socket.destroy()
        resolvePort()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() >= deadline) {
          rejectPort(new Error(`Timed out after ${timeoutMs}ms waiting for ${host}:${port}`))
        } else {
          setTimeout(attempt, intervalMs)
        }
      })
    }
    attempt()
  })
}

/** Waits for every infrastructure port to accept connections. */
export async function waitForInfrastructure(
  ports = infrastructurePorts,
  options = {},
) {
  for (const port of ports) {
    await waitForPort(port, options)
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}

/**
 * Polls a health endpoint until it returns 2xx or the bounded timeout elapses.
 */
export async function waitForHttp(
  url,
  { timeoutMs = HEALTH_TIMEOUT_MS, intervalMs = 500, fetchImpl = fetch } = {},
) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        return
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${url}` +
      (lastError instanceof Error ? ` (last error: ${lastError.message})` : ''),
  )
}

class ProcessSupervisor {
  constructor() {
    this.children = new Map()
    this.shuttingDown = false
    this.failure = undefined
    this.resolveRun = undefined
    this.done = new Promise((resolveDone) => {
      this.resolveRun = resolveDone
    })
  }

  run(name, { command, args = [], cwd = repoRoot, env = process.env, critical = true }) {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    this.children.set(name, { child, pid: child.pid, critical })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    pipeWithPrefix(child.stdout, name)
    pipeWithPrefix(child.stderr, name)
    child.on('error', (error) => {
      this.handleExit(name, `failed to start: ${error.message}`)
    })
    child.on('exit', (code, signal) => {
      this.handleExit(name, signal === null ? `exited with code ${code}` : `exited on ${signal}`)
    })
    return child
  }

  handleExit(name, reason) {
    if (this.shuttingDown) {
      return
    }
    const entry = this.children.get(name)
    this.children.delete(name)
    if (entry?.critical === false) {
      log(`process ${name} ${reason}`)
      return
    }
    this.failure = new Error(`Process ${name} ${reason}. Shutting the stack down.`)
    log(this.failure.message)
    this.resolveRun?.()
  }

  async wait() {
    await this.done
  }

  async stopAll() {
    this.shuttingDown = true
    for (const [name, entry] of this.children) {
      log(`stopping ${name}`)
      terminateGroup(entry.pid)
    }
    await sleep(1_000)
    for (const [, entry] of this.children) {
      if (isProcessAlive(entry.pid)) {
        terminateGroup(entry.pid, 'SIGKILL')
      }
    }
    this.children.clear()
  }
}

function pipeWithPrefix(stream, name) {
  if (stream === null || stream === undefined) {
    return
  }
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      log(formatLogLine(name, redactSecrets(buffer.slice(0, index))))
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
    }
  })
  stream.on('end', () => {
    if (buffer !== '') {
      log(formatLogLine(name, redactSecrets(buffer)))
    }
  })
}

function terminateGroup(pid, signal = 'SIGTERM') {
  if (pid === undefined) {
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

function isProcessAlive(pid) {
  if (pid === undefined) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function log(message) {
  process.stdout.write(`${message}\n`)
}

function runCommand(command, args, { cwd = repoRoot, env = process.env } = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    log(`$ ${formatCommand(command, args)}`)
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    pipeWithPrefix(child.stdout, command)
    pipeWithPrefix(child.stderr, command)
    child.on('error', rejectCommand)
    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand()
      } else {
        rejectCommand(new Error(`${formatCommand(command, args)} exited with code ${code}`))
      }
    })
  })
}

function formatCommand(command, args) {
  return [command, ...args].join(' ')
}

function commandExists(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' })
  return result.status === 0
}

async function preflight() {
  for (const command of ['docker', 'go', 'goose', 'npm']) {
    if (!commandExists(command)) {
      throw new Error(
        `${command} is required for \`make dev\`. Install it or use \`npm run dev:mock\`.`,
      )
    }
  }
  await assertPortsFree([...apiPorts, vitePort])
}

async function startInfrastructure() {
  try {
    await runCommand('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '120'])
  } catch (error) {
    throw new Error(
      `Could not start local infrastructure: ${error instanceof Error ? error.message : String(error)}. ` +
        'Another local stack may own ports 5431-5434 or 5672. Run `make dev-down`, or, when ' +
        'infrastructure is already healthy, attach with `node scripts/dev.mjs --no-infra`.',
    )
  }
}

async function runMigrations() {
  for (const service of serviceDefinitions) {
    await runCommand(
      'goose',
      ['-dir', service.migrationDir, 'postgres', service.databaseUrl, 'up'],
      { cwd: join(repoRoot, service.dir) },
    )
  }
}

async function buildBinary(definition) {
  const directory = join(repoRoot, definition.dir)
  await mkdir(join(directory, 'bin'), { recursive: true })
  await runCommand('go', ['build', '-o', 'bin/', '.'], { cwd: directory })
  return join(directory, 'bin', definition.name)
}

async function buildAll() {
  for (const definition of [...serviceDefinitions, ...workerDefinitions]) {
    await buildBinary(definition)
  }
}

async function writePidFile(supervisor) {
  await mkdir(dirname(pidFile), { recursive: true })
  const pids = [...supervisor.children.entries()].map(([name, entry]) => ({
    name,
    pid: entry.pid,
  }))
  await writeFile(pidFile, JSON.stringify(pids, null, 2))
}

async function readPidFile() {
  try {
    const contents = await readFile(pidFile, 'utf8')
    const parsed = JSON.parse(contents)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function stopApplicationChildren() {
  const entries = await readPidFile()
  for (const entry of entries) {
    if (typeof entry?.pid === 'number') {
      log(`stopping ${entry.name ?? 'process'} (${entry.pid})`)
      terminateGroup(entry.pid)
    }
  }
  await sleep(500)
  for (const entry of entries) {
    if (typeof entry?.pid === 'number' && isProcessAlive(entry.pid)) {
      terminateGroup(entry.pid, 'SIGKILL')
    }
  }
  await rm(pidFile, { force: true })
}

async function down() {
  await stopApplicationChildren()
  await runCommand('docker', ['compose', 'down'])
}

async function reset() {
  await runCommand('docker', ['compose', 'down', '-v'])
  await startInfrastructure()
  await runMigrations()
}

async function dev({ skipInfra = false } = {}) {
  await preflight()
  if (skipInfra) {
    await waitForInfrastructure()
    log('attached to already-healthy infrastructure')
  } else {
    await startInfrastructure()
  }
  await runMigrations()
  await buildAll()

  const supervisor = new ProcessSupervisor()
  const shutdown = (signal) => {
    log(`received ${signal}; cleaning up application processes`)
    void supervisor.stopAll().then(() => {
      process.exitCode = 0
      supervisor.resolveRun?.()
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // User Service first: dependent services warm JWKS state from it.
  supervisor.run('user-service', {
    command: join(repoRoot, serviceDefinitions[0].dir, 'bin', serviceDefinitions[0].name),
  })
  await waitForHttp(`http://127.0.0.1:${serviceDefinitions[0].port}/health`)
  log('user-service is healthy')

  for (const service of serviceDefinitions.slice(1)) {
    supervisor.run(service.name, {
      command: join(repoRoot, service.dir, 'bin', service.name),
    })
  }
  for (const service of serviceDefinitions.slice(1)) {
    await waitForHttp(`http://127.0.0.1:${service.port}/health`)
    log(`${service.name} is healthy`)
  }

  for (const worker of workerDefinitions) {
    supervisor.run(worker.name, {
      command: join(repoRoot, worker.dir, 'bin', worker.name),
    })
  }
  log('workers started')

  supervisor.run('vite', {
    command: 'npm',
    args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    cwd: join(repoRoot, 'apps/web-frontend'),
    critical: true,
  })
  await waitForHttp(`http://127.0.0.1:${vitePort}/`, { timeoutMs: VITE_TIMEOUT_MS })
  log(`Galaxify is ready at http://127.0.0.1:${vitePort}/`)

  await writePidFile(supervisor)
  await supervisor.wait()
  await supervisor.stopAll()
  if (supervisor.failure !== undefined) {
    throw supervisor.failure
  }
}

async function main() {
  const mode = parseSupervisorArgs(process.argv.slice(2))
  if (mode === 'infra') {
    await startInfrastructure()
    log('infrastructure is healthy')
    return
  }
  if (mode === 'down') {
    await down()
    log('application processes and infrastructure stopped; data preserved')
    return
  }
  if (mode === 'reset') {
    await reset()
    log('local infrastructure volumes removed and migrations reapplied')
    return
  }
  if (mode === 'dev-no-infra') {
    await dev({ skipInfra: true })
    log('stack stopped cleanly; infrastructure and data preserved')
    return
  }
  await dev()
  log('stack stopped cleanly; infrastructure and data preserved')
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
