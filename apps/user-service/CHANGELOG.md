# Changelog

## 1.0.0 (2026-09-06)


### Features

* **auth:** implement JWT access token issuance and verification with tests ([#44](https://github.com/thalesraymond/galaxify-monorepo/issues/44)) ([8787704](https://github.com/thalesraymond/galaxify-monorepo/commit/8787704f1b395c659daeda7e71c4c4e6f5b9e7a5))
* **auth:** refactor JWKS cache interface and update key retrieval logic ([#104](https://github.com/thalesraymond/galaxify-monorepo/issues/104)) ([aba3f9e](https://github.com/thalesraymond/galaxify-monorepo/commit/aba3f9ee1b00d208cd127b6791946d3890bcd225))
* **broker:** Implement event publishing and processing with RabbitMQ ([#21](https://github.com/thalesraymond/galaxify-monorepo/issues/21)) ([f674e79](https://github.com/thalesraymond/galaxify-monorepo/commit/f674e798baf351be5b2539c71ccbab6cec5480a3))
* **daily-service:** daily crud operations ([#101](https://github.com/thalesraymond/galaxify-monorepo/issues/101)) ([9a7ab2b](https://github.com/thalesraymond/galaxify-monorepo/commit/9a7ab2b095cf6e3659d7cf27c1346450ef8bb2cd))
* implement user registration and session management ([#89](https://github.com/thalesraymond/galaxify-monorepo/issues/89)) ([4898ae9](https://github.com/thalesraymond/galaxify-monorepo/commit/4898ae929d1fa6ee5fed80a74ff5aa9185fca41c))
* **middleware:** Refactor health check handling and add request ID middleware ([#22](https://github.com/thalesraymond/galaxify-monorepo/issues/22)) ([db2087c](https://github.com/thalesraymond/galaxify-monorepo/commit/db2087ca0d8219503d3c838307c34304af77beed))
* **missed-daily:** Implement missed dailies cron worker and outbox setup ([#103](https://github.com/thalesraymond/galaxify-monorepo/issues/103)) ([0a859ff](https://github.com/thalesraymond/galaxify-monorepo/commit/0a859ff7d4c9e2fb10a5b468f22971974bd5854d))
* serve HTTP health endpoint in each Go service (ADR-0002) ([#6](https://github.com/thalesraymond/galaxify-monorepo/issues/6)) ([32ebd2f](https://github.com/thalesraymond/galaxify-monorepo/commit/32ebd2f1dfa6097240cbeb5c8c4a8b38e41f50f0))
* **user-service:** Add user table feature ([#86](https://github.com/thalesraymond/galaxify-monorepo/issues/86)) ([2b0588c](https://github.com/thalesraymond/galaxify-monorepo/commit/2b0588c0bde16ac09c2af5d3af12a127c95f235e))
* **user-service:** implement GET/PATCH/DELETE /users/me handlers ([#92](https://github.com/thalesraymond/galaxify-monorepo/issues/92)) ([398cc06](https://github.com/thalesraymond/galaxify-monorepo/commit/398cc06cb51cb3214ddcaf0b88dde0e3e7baa59b))
* **user-service:** implement POST /auth/refresh with family-based rotation ([#51](https://github.com/thalesraymond/galaxify-monorepo/issues/51)) ([#91](https://github.com/thalesraymond/galaxify-monorepo/issues/91)) ([b4e1716](https://github.com/thalesraymond/galaxify-monorepo/commit/b4e17168b34ab2f2f6bf8dc003a2964c5ab5c41e))
* **user-service:** Implement user signup functionality with JWT key management ([#88](https://github.com/thalesraymond/galaxify-monorepo/issues/88)) ([715286d](https://github.com/thalesraymond/galaxify-monorepo/commit/715286d25945201f138f745b77280e8316717547))
