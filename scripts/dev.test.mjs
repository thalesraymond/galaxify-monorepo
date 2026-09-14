import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertPortsFree,
  formatLogLine,
  parseSupervisorArgs,
  redactSecrets,
  waitForHttp,
} from './dev.mjs'

test('parseSupervisorArgs maps canonical Make modes', () => {
  assert.equal(parseSupervisorArgs([]), 'dev')
  assert.equal(parseSupervisorArgs(['--infra']), 'infra')
  assert.equal(parseSupervisorArgs(['--no-infra']), 'dev-no-infra')
  assert.equal(parseSupervisorArgs(['--down']), 'down')
  assert.equal(parseSupervisorArgs(['--reset']), 'reset')
  assert.throws(() => parseSupervisorArgs(['--nope']), /Unknown option/)
  assert.throws(() => parseSupervisorArgs(['--down', '--reset']), /at most one option/)
})

test('redactSecrets removes credentials and tokens from logs', () => {
  assert.equal(
    redactSecrets('postgres://postgres:password@localhost:5431/user_db'),
    'postgres://postgres:****@localhost:5431/user_db',
  )
  assert.equal(
    redactSecrets('amqp://guest:guest@localhost:5672/'),
    'amqp://guest:****@localhost:5672/',
  )
  assert.equal(redactSecrets('Authorization: Bearer abc.def.ghi'), 'Authorization: Bearer ****')
  assert.equal(redactSecrets('{"refresh_token":"secret-value"}'), '{"refresh_token":"****"}')
})

test('formatLogLine prefixes the process name', () => {
  assert.equal(formatLogLine('user-service', 'listening'), '[user-service] listening')
})

test('assertPortsFree reports every occupied port actionably', async () => {
  await assert.doesNotReject(assertPortsFree([8081, 8082], async () => true))
  await assert.rejects(assertPortsFree([8081, 5173], async () => false), /8081, 5173/)
})

test('waitForHttp resolves on a 2xx health response', async () => {
  await assert.doesNotReject(
    waitForHttp('http://127.0.0.1:8081/health', {
      fetchImpl: async () => new Response(null, { status: 200 }),
    }),
  )
})

test('waitForHttp times out with the last observed status', async () => {
  await assert.rejects(
    waitForHttp('http://127.0.0.1:9999/health', {
      timeoutMs: 60,
      intervalMs: 10,
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    /last error: HTTP 503/,
  )
})
