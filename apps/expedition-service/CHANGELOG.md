# Changelog

## 1.0.0 (2026-09-12)


### Features

* **auth:** implement JWT access token issuance and verification with tests ([#44](https://github.com/thalesraymond/galaxify-monorepo/issues/44)) ([8787704](https://github.com/thalesraymond/galaxify-monorepo/commit/8787704f1b395c659daeda7e71c4c4e6f5b9e7a5))
* **broker:** Implement event publishing and processing with RabbitMQ ([#21](https://github.com/thalesraymond/galaxify-monorepo/issues/21)) ([f674e79](https://github.com/thalesraymond/galaxify-monorepo/commit/f674e798baf351be5b2539c71ccbab6cec5480a3))
* **expedition:** Add expedition schema and enforce active expedition constraint ([#119](https://github.com/thalesraymond/galaxify-monorepo/issues/119)) ([7ef3d82](https://github.com/thalesraymond/galaxify-monorepo/commit/7ef3d82407850eb09fdc092987d5a43fd7ae553e))
* **expedition:** consume ship status updates ([#69](https://github.com/thalesraymond/galaxify-monorepo/issues/69)) ([#120](https://github.com/thalesraymond/galaxify-monorepo/issues/120)) ([6027540](https://github.com/thalesraymond/galaxify-monorepo/commit/60275406baf9d3af862403bbee36d7fb8192a6b2))
* **expedition:** implement launch endpoint ([#70](https://github.com/thalesraymond/galaxify-monorepo/issues/70)) ([#124](https://github.com/thalesraymond/galaxify-monorepo/issues/124)) ([7964f5b](https://github.com/thalesraymond/galaxify-monorepo/commit/7964f5b7fa7da6e0d52b3fa30d773ae8d3f548f6))
* **expedition:** seed ship cache on user creation ([#121](https://github.com/thalesraymond/galaxify-monorepo/issues/121)) ([e56b793](https://github.com/thalesraymond/galaxify-monorepo/commit/e56b793b3399348bd71a5881007cc17e5800df7c))
* implement expedition read endpoints ([#122](https://github.com/thalesraymond/galaxify-monorepo/issues/122)) ([c58d821](https://github.com/thalesraymond/galaxify-monorepo/commit/c58d82133d894153f6f64441a9ca54e6280e485e))
* **middleware:** Refactor health check handling and add request ID middleware ([#22](https://github.com/thalesraymond/galaxify-monorepo/issues/22)) ([db2087c](https://github.com/thalesraymond/galaxify-monorepo/commit/db2087ca0d8219503d3c838307c34304af77beed))
* **outbox:** Implement transactional outbox for event staging ([#125](https://github.com/thalesraymond/galaxify-monorepo/issues/125)) ([e39bb32](https://github.com/thalesraymond/galaxify-monorepo/commit/e39bb320a3a9102ae49850a63741986add093a21))
* serve HTTP health endpoint in each Go service (ADR-0002) ([#6](https://github.com/thalesraymond/galaxify-monorepo/issues/6)) ([32ebd2f](https://github.com/thalesraymond/galaxify-monorepo/commit/32ebd2f1dfa6097240cbeb5c8c4a8b38e41f50f0))
* **user-service:** Implement user signup functionality with JWT key management ([#88](https://github.com/thalesraymond/galaxify-monorepo/issues/88)) ([715286d](https://github.com/thalesraymond/galaxify-monorepo/commit/715286d25945201f138f745b77280e8316717547))
