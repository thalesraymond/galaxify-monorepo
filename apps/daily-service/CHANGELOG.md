# Changelog

## 1.0.0 (2026-09-06)


### Features

* **auth:** implement JWT access token issuance and verification with tests ([#44](https://github.com/thalesraymond/galaxify-monorepo/issues/44)) ([8787704](https://github.com/thalesraymond/galaxify-monorepo/commit/8787704f1b395c659daeda7e71c4c4e6f5b9e7a5))
* **auth:** refactor JWKS cache interface and update key retrieval logic ([#104](https://github.com/thalesraymond/galaxify-monorepo/issues/104)) ([aba3f9e](https://github.com/thalesraymond/galaxify-monorepo/commit/aba3f9ee1b00d208cd127b6791946d3890bcd225))
* **broker:** Implement event publishing and processing with RabbitMQ ([#21](https://github.com/thalesraymond/galaxify-monorepo/issues/21)) ([f674e79](https://github.com/thalesraymond/galaxify-monorepo/commit/f674e798baf351be5b2539c71ccbab6cec5480a3))
* **daily-service:** daily crud operations ([#101](https://github.com/thalesraymond/galaxify-monorepo/issues/101)) ([9a7ab2b](https://github.com/thalesraymond/galaxify-monorepo/commit/9a7ab2b095cf6e3659d7cf27c1346450ef8bb2cd))
* **daily-service:** Implement Daily Service schema ([#93](https://github.com/thalesraymond/galaxify-monorepo/issues/93)) ([f0db628](https://github.com/thalesraymond/galaxify-monorepo/commit/f0db628166737b47366e3d1443fe78ae45ef2b95))
* **daily-service:** implement POST /dailies/{id}/complete endpoint ([#102](https://github.com/thalesraymond/galaxify-monorepo/issues/102)) ([7379f00](https://github.com/thalesraymond/galaxify-monorepo/commit/7379f00e5e8719e164e73ad0251a6dec77d19c59))
* **events:** implement generic Idempotent Consumer Pipeline and migrate daily-service consumers ([#105](https://github.com/thalesraymond/galaxify-monorepo/issues/105)) ([#106](https://github.com/thalesraymond/galaxify-monorepo/issues/106)) ([ba0e379](https://github.com/thalesraymond/galaxify-monorepo/commit/ba0e37956bb05e6f6e1760d8c0b58698844e66ba))
* **middleware:** Refactor health check handling and add request ID middleware ([#22](https://github.com/thalesraymond/galaxify-monorepo/issues/22)) ([db2087c](https://github.com/thalesraymond/galaxify-monorepo/commit/db2087ca0d8219503d3c838307c34304af77beed))
* **missed-daily:** Implement missed dailies cron worker and outbox setup ([#103](https://github.com/thalesraymond/galaxify-monorepo/issues/103)) ([0a859ff](https://github.com/thalesraymond/galaxify-monorepo/commit/0a859ff7d4c9e2fb10a5b468f22971974bd5854d))
* serve HTTP health endpoint in each Go service (ADR-0002) ([#6](https://github.com/thalesraymond/galaxify-monorepo/issues/6)) ([32ebd2f](https://github.com/thalesraymond/galaxify-monorepo/commit/32ebd2f1dfa6097240cbeb5c8c4a8b38e41f50f0))
* **user-deleted:** implement user.deleted event handling and cache deletion ([#100](https://github.com/thalesraymond/galaxify-monorepo/issues/100)) ([0bd42d3](https://github.com/thalesraymond/galaxify-monorepo/commit/0bd42d3046a61274cf5ed9c9fb3327ff8561ef00))
* **user-service:** Implement user signup functionality with JWT key management ([#88](https://github.com/thalesraymond/galaxify-monorepo/issues/88)) ([715286d](https://github.com/thalesraymond/galaxify-monorepo/commit/715286d25945201f138f745b77280e8316717547))


### Bug Fixes

* **daily-service:** implement recurring daily lifecycle, archival, and cron rollover ([#110](https://github.com/thalesraymond/galaxify-monorepo/issues/110)) ([5fd0df9](https://github.com/thalesraymond/galaxify-monorepo/commit/5fd0df94d76bf1d0fd50ffbb0d0a7733b4c5558d))
