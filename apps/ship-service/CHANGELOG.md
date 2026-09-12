# Changelog

## 1.0.0 (2026-09-12)


### Features

* **auth:** implement JWT access token issuance and verification with tests ([#44](https://github.com/thalesraymond/galaxify-monorepo/issues/44)) ([8787704](https://github.com/thalesraymond/galaxify-monorepo/commit/8787704f1b395c659daeda7e71c4c4e6f5b9e7a5))
* **broker:** Implement event publishing and processing with RabbitMQ ([#21](https://github.com/thalesraymond/galaxify-monorepo/issues/21)) ([f674e79](https://github.com/thalesraymond/galaxify-monorepo/commit/f674e798baf351be5b2539c71ccbab6cec5480a3))
* **expedition:** implement launch endpoint ([#70](https://github.com/thalesraymond/galaxify-monorepo/issues/70)) ([#124](https://github.com/thalesraymond/galaxify-monorepo/issues/124)) ([7964f5b](https://github.com/thalesraymond/galaxify-monorepo/commit/7964f5b7fa7da6e0d52b3fa30d773ae8d3f548f6))
* implement expedition read endpoints ([#122](https://github.com/thalesraymond/galaxify-monorepo/issues/122)) ([c58d821](https://github.com/thalesraymond/galaxify-monorepo/commit/c58d82133d894153f6f64441a9ca54e6280e485e))
* **middleware:** Refactor health check handling and add request ID middleware ([#22](https://github.com/thalesraymond/galaxify-monorepo/issues/22)) ([db2087c](https://github.com/thalesraymond/galaxify-monorepo/commit/db2087ca0d8219503d3c838307c34304af77beed))
* **outbox:** Implement transactional outbox for event staging ([#125](https://github.com/thalesraymond/galaxify-monorepo/issues/125)) ([e39bb32](https://github.com/thalesraymond/galaxify-monorepo/commit/e39bb320a3a9102ae49850a63741986add093a21))
* serve HTTP health endpoint in each Go service (ADR-0002) ([#6](https://github.com/thalesraymond/galaxify-monorepo/issues/6)) ([32ebd2f](https://github.com/thalesraymond/galaxify-monorepo/commit/32ebd2f1dfa6097240cbeb5c8c4a8b38e41f50f0))
* **ship-service:** consume daily outcome events ([#64](https://github.com/thalesraymond/galaxify-monorepo/issues/64)) ([#116](https://github.com/thalesraymond/galaxify-monorepo/issues/116)) ([6966af3](https://github.com/thalesraymond/galaxify-monorepo/commit/6966af3145cbc68a02e6597348a559893b25c993))
* **ship-service:** define ships table schema and sqlc queries ([#62](https://github.com/thalesraymond/galaxify-monorepo/issues/62)) ([#108](https://github.com/thalesraymond/galaxify-monorepo/issues/108)) ([4f953a2](https://github.com/thalesraymond/galaxify-monorepo/commit/4f953a26d919b8fac7de5c61ac81818318b8a708))
* **ship-service:** Implement expedition lifecycle event consumers ([#123](https://github.com/thalesraymond/galaxify-monorepo/issues/123)) ([e1cee84](https://github.com/thalesraymond/galaxify-monorepo/commit/e1cee84e0b3fab173cb69260bdd866215abfc888))
* **ship-service:** implement GET /ships/me handler ([#67](https://github.com/thalesraymond/galaxify-monorepo/issues/67)) ([#118](https://github.com/thalesraymond/galaxify-monorepo/issues/118)) ([15d99fe](https://github.com/thalesraymond/galaxify-monorepo/commit/15d99fe92b1c99e47a7dc8541aa171de166f381d))
* **ship-service:** implement user.created consumer ([#63](https://github.com/thalesraymond/galaxify-monorepo/issues/63)) ([#112](https://github.com/thalesraymond/galaxify-monorepo/issues/112)) ([6275bbb](https://github.com/thalesraymond/galaxify-monorepo/commit/6275bbb936a0ad0a5595008ae26cea2551cda5e9))
* **ship:** add repair endpoint ([#117](https://github.com/thalesraymond/galaxify-monorepo/issues/117)) ([8cc152f](https://github.com/thalesraymond/galaxify-monorepo/commit/8cc152f53fdc9c622721a76531806fe1fa100987))
* **user-service:** Implement user signup functionality with JWT key management ([#88](https://github.com/thalesraymond/galaxify-monorepo/issues/88)) ([715286d](https://github.com/thalesraymond/galaxify-monorepo/commit/715286d25945201f138f745b77280e8316717547))
