# Changelog

## 1.0.0 (2026-09-06)


### Features

* **auth:** implement JWT access token issuance and verification with tests ([#44](https://github.com/thalesraymond/galaxify-monorepo/issues/44)) ([8787704](https://github.com/thalesraymond/galaxify-monorepo/commit/8787704f1b395c659daeda7e71c4c4e6f5b9e7a5))
* **broker:** Implement event publishing and processing with RabbitMQ ([#21](https://github.com/thalesraymond/galaxify-monorepo/issues/21)) ([f674e79](https://github.com/thalesraymond/galaxify-monorepo/commit/f674e798baf351be5b2539c71ccbab6cec5480a3))
* **middleware:** Refactor health check handling and add request ID middleware ([#22](https://github.com/thalesraymond/galaxify-monorepo/issues/22)) ([db2087c](https://github.com/thalesraymond/galaxify-monorepo/commit/db2087ca0d8219503d3c838307c34304af77beed))
* serve HTTP health endpoint in each Go service (ADR-0002) ([#6](https://github.com/thalesraymond/galaxify-monorepo/issues/6)) ([32ebd2f](https://github.com/thalesraymond/galaxify-monorepo/commit/32ebd2f1dfa6097240cbeb5c8c4a8b38e41f50f0))
* **ship-service:** define ships table schema and sqlc queries ([#62](https://github.com/thalesraymond/galaxify-monorepo/issues/62)) ([#108](https://github.com/thalesraymond/galaxify-monorepo/issues/108)) ([4f953a2](https://github.com/thalesraymond/galaxify-monorepo/commit/4f953a26d919b8fac7de5c61ac81818318b8a708))
* **ship-service:** implement user.created consumer ([#63](https://github.com/thalesraymond/galaxify-monorepo/issues/63)) ([#112](https://github.com/thalesraymond/galaxify-monorepo/issues/112)) ([6275bbb](https://github.com/thalesraymond/galaxify-monorepo/commit/6275bbb936a0ad0a5595008ae26cea2551cda5e9))
* **user-service:** Implement user signup functionality with JWT key management ([#88](https://github.com/thalesraymond/galaxify-monorepo/issues/88)) ([715286d](https://github.com/thalesraymond/galaxify-monorepo/commit/715286d25945201f138f745b77280e8316717547))
