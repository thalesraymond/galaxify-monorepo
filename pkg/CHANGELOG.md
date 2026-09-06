# Changelog

## 1.0.0 (2026-09-06)


### Features

* **auth:** add JWK generation and JWKS fetching functionality with tests ([#45](https://github.com/thalesraymond/galaxify-monorepo/issues/45)) ([9f1af06](https://github.com/thalesraymond/galaxify-monorepo/commit/9f1af0600a7b0fe28a555fb8f189d7469cf881eb))
* **auth:** add refresh token rotation functionality with tests ([#37](https://github.com/thalesraymond/galaxify-monorepo/issues/37)) ([1b2dfdd](https://github.com/thalesraymond/galaxify-monorepo/commit/1b2dfdd06a432dab46dc2c4004b3b34b7d6e532e))
* **auth:** implement Ed25519 keypair generation and loading functions ([#35](https://github.com/thalesraymond/galaxify-monorepo/issues/35)) ([caf7901](https://github.com/thalesraymond/galaxify-monorepo/commit/caf79014d7d1e5beb4a64580d989b34f26c1192e))
* **auth:** implement JWT access token issuance and verification with tests ([#44](https://github.com/thalesraymond/galaxify-monorepo/issues/44)) ([8787704](https://github.com/thalesraymond/galaxify-monorepo/commit/8787704f1b395c659daeda7e71c4c4e6f5b9e7a5))
* **auth:** Implement JWT authentication middleware with JWKS caching ([#46](https://github.com/thalesraymond/galaxify-monorepo/issues/46)) ([d200550](https://github.com/thalesraymond/galaxify-monorepo/commit/d20055078f0bf36cdbb3e030cf611cb9b997550b))
* **auth:** implement password hashing and comparison functions with tests ([#36](https://github.com/thalesraymond/galaxify-monorepo/issues/36)) ([c7c4be1](https://github.com/thalesraymond/galaxify-monorepo/commit/c7c4be1504f86ab4fc71ce0783d66907e957f67f))
* **auth:** refactor JWKS cache interface and update key retrieval logic ([#104](https://github.com/thalesraymond/galaxify-monorepo/issues/104)) ([aba3f9e](https://github.com/thalesraymond/galaxify-monorepo/commit/aba3f9ee1b00d208cd127b6791946d3890bcd225))
* **broker:** Implement event publishing and processing with RabbitMQ ([#21](https://github.com/thalesraymond/galaxify-monorepo/issues/21)) ([f674e79](https://github.com/thalesraymond/galaxify-monorepo/commit/f674e798baf351be5b2539c71ccbab6cec5480a3))
* **daily-service:** daily crud operations ([#101](https://github.com/thalesraymond/galaxify-monorepo/issues/101)) ([9a7ab2b](https://github.com/thalesraymond/galaxify-monorepo/commit/9a7ab2b095cf6e3659d7cf27c1346450ef8bb2cd))
* **events:** dead-letter failed events to galaxify.dead_letters via galaxify.dlx ([#98](https://github.com/thalesraymond/galaxify-monorepo/issues/98)) ([62791dd](https://github.com/thalesraymond/galaxify-monorepo/commit/62791dd0cade2af654e95fd1734e5088dea1908a)), closes [#96](https://github.com/thalesraymond/galaxify-monorepo/issues/96)
* **events:** declare galaxify.ae alternate exchange to capture unroutable events ([#97](https://github.com/thalesraymond/galaxify-monorepo/issues/97)) ([8043c12](https://github.com/thalesraymond/galaxify-monorepo/commit/8043c12c35ab37488d7f949b403d612031df747f)), closes [#95](https://github.com/thalesraymond/galaxify-monorepo/issues/95)
* **events:** implement generic Idempotent Consumer Pipeline and migrate daily-service consumers ([#105](https://github.com/thalesraymond/galaxify-monorepo/issues/105)) ([#106](https://github.com/thalesraymond/galaxify-monorepo/issues/106)) ([ba0e379](https://github.com/thalesraymond/galaxify-monorepo/commit/ba0e37956bb05e6f6e1760d8c0b58698844e66ba))
* **httperr:** implement error handling and response envelope for HTTP services ([#23](https://github.com/thalesraymond/galaxify-monorepo/issues/23)) ([8c677da](https://github.com/thalesraymond/galaxify-monorepo/commit/8c677da8f04a550048d3866a5a28cc4f574b4517))
* **middleware:** Refactor health check handling and add request ID middleware ([#22](https://github.com/thalesraymond/galaxify-monorepo/issues/22)) ([db2087c](https://github.com/thalesraymond/galaxify-monorepo/commit/db2087ca0d8219503d3c838307c34304af77beed))
* **missed-daily:** Implement missed dailies cron worker and outbox setup ([#103](https://github.com/thalesraymond/galaxify-monorepo/issues/103)) ([0a859ff](https://github.com/thalesraymond/galaxify-monorepo/commit/0a859ff7d4c9e2fb10a5b468f22971974bd5854d))
* serve HTTP health endpoint in each Go service (ADR-0002) ([#6](https://github.com/thalesraymond/galaxify-monorepo/issues/6)) ([32ebd2f](https://github.com/thalesraymond/galaxify-monorepo/commit/32ebd2f1dfa6097240cbeb5c8c4a8b38e41f50f0))
* **user-service:** implement GET/PATCH/DELETE /users/me handlers ([#92](https://github.com/thalesraymond/galaxify-monorepo/issues/92)) ([398cc06](https://github.com/thalesraymond/galaxify-monorepo/commit/398cc06cb51cb3214ddcaf0b88dde0e3e7baa59b))


### Performance Improvements

* optimize authorization header prefix check via slicing ([#81](https://github.com/thalesraymond/galaxify-monorepo/issues/81)) ([843f865](https://github.com/thalesraymond/galaxify-monorepo/commit/843f865c3251336a11e6033606c580948d397597))
