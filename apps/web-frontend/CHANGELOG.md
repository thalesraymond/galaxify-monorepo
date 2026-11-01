# Changelog

## [1.1.0](https://github.com/thalesraymond/galaxify-monorepo/compare/web-frontend-v1.0.1...web-frontend-v1.1.0) (2026-11-01)


### Features

* **web:** gate balance-dependent actions safely ([#227](https://github.com/thalesraymond/galaxify-monorepo/issues/227)) ([#266](https://github.com/thalesraymond/galaxify-monorepo/issues/266)) ([a95db7b](https://github.com/thalesraymond/galaxify-monorepo/commit/a95db7ba2e3ebdd68671a10357e23d5751282214))
* **web:** make Expedition result observation survive navigation ([#222](https://github.com/thalesraymond/galaxify-monorepo/issues/222)) ([#256](https://github.com/thalesraymond/galaxify-monorepo/issues/256)) ([c19d78f](https://github.com/thalesraymond/galaxify-monorepo/commit/c19d78fcd8172f7368e4aa3fbc1618bab8940b8f))
* **web:** reconcile Daily awards without losing their baseline ([#223](https://github.com/thalesraymond/galaxify-monorepo/issues/223))  ([#260](https://github.com/thalesraymond/galaxify-monorepo/issues/260)) ([10be13b](https://github.com/thalesraymond/galaxify-monorepo/commit/10be13bc71b71dab2a42ffee684e3676bc015d6b))
* **web:** reconcile Expedition launch deduction ([#225](https://github.com/thalesraymond/galaxify-monorepo/issues/225)) ([#262](https://github.com/thalesraymond/galaxify-monorepo/issues/262)) ([6ec832c](https://github.com/thalesraymond/galaxify-monorepo/commit/6ec832c06411a1fb4234f636557ac13cf3e33228))
* **web:** reconcile Expedition rewards across views ([#226](https://github.com/thalesraymond/galaxify-monorepo/issues/226)) ([#264](https://github.com/thalesraymond/galaxify-monorepo/issues/264)) ([7a2e880](https://github.com/thalesraymond/galaxify-monorepo/commit/7a2e8800bb45051a2dc7afec37e3a5c56e0d8721))
* **web:** verify reconciliation flows and retire duplicates ([#228](https://github.com/thalesraymond/galaxify-monorepo/issues/228)) ([#268](https://github.com/thalesraymond/galaxify-monorepo/issues/268)) ([268352d](https://github.com/thalesraymond/galaxify-monorepo/commit/268352dab0564dc9f2afdf92c53385465210ddc8))


### Bug Fixes

* **dailies:** derive recurring deadline on the backend ([#207](https://github.com/thalesraymond/galaxify-monorepo/issues/207)) ([19741be](https://github.com/thalesraymond/galaxify-monorepo/commit/19741befb1ca745823aaec9b82eef6015eb7d484))
* **web-frontend:** align lint and TypeScript peer versions ([#205](https://github.com/thalesraymond/galaxify-monorepo/issues/205)) ([85b4021](https://github.com/thalesraymond/galaxify-monorepo/commit/85b40211734cdc480fcde9c94e64da4978d54225))
* **web:** keep Create Daily available in every list state ([#244](https://github.com/thalesraymond/galaxify-monorepo/issues/244)) ([#251](https://github.com/thalesraymond/galaxify-monorepo/issues/251)) ([73d81f2](https://github.com/thalesraymond/galaxify-monorepo/commit/73d81f29c4491138b02d68af7b76a3dcaa0ca4f1))
* **web:** prioritize Daily work above mobile chrome ([#245](https://github.com/thalesraymond/galaxify-monorepo/issues/245)) ([#252](https://github.com/thalesraymond/galaxify-monorepo/issues/252)) ([c9cc3f3](https://github.com/thalesraymond/galaxify-monorepo/commit/c9cc3f3bccd29dd83c2fc044b1db04d99022fa3f))
* **web:** reduce Dashboard support-panel height ([#248](https://github.com/thalesraymond/galaxify-monorepo/issues/248)) ([#254](https://github.com/thalesraymond/galaxify-monorepo/issues/254)) ([0cf4fc9](https://github.com/thalesraymond/galaxify-monorepo/commit/0cf4fc97162942e56f641d08e8373594d68b6575))

## [1.0.1](https://github.com/thalesraymond/galaxify-monorepo/compare/web-frontend-v1.0.0...web-frontend-v1.0.1) (2026-09-24)


### Bug Fixes

* **web:** satisfy preserve-caught-error and no-useless-assignment ([#196](https://github.com/thalesraymond/galaxify-monorepo/issues/196)) ([ae5a14f](https://github.com/thalesraymond/galaxify-monorepo/commit/ae5a14f760e6281b8c379a0fc95f806bd87db250))

## 1.0.0 (2026-09-18)


### Features

* **phase-1:** auth, session lifecycle, Profile, and account actions ([#153](https://github.com/thalesraymond/galaxify-monorepo/issues/153)) ([#170](https://github.com/thalesraymond/galaxify-monorepo/issues/170)) ([10feef4](https://github.com/thalesraymond/galaxify-monorepo/commit/10feef4fd39f290629a723d4295c73c165ccd68e))
* **phase-1:** complete Daily, Ship, Expedition, and User convergence ([#177](https://github.com/thalesraymond/galaxify-monorepo/issues/177)) ([6e9b664](https://github.com/thalesraymond/galaxify-monorepo/commit/6e9b664929a2661a2f32dc7a20e79c69f9cf41db))
* **phase-1:** frontier — deterministic mocks, Daily history cursors, Daily + Expedition contracts ([#143](https://github.com/thalesraymond/galaxify-monorepo/issues/143) [#150](https://github.com/thalesraymond/galaxify-monorepo/issues/150) [#151](https://github.com/thalesraymond/galaxify-monorepo/issues/151) [#152](https://github.com/thalesraymond/galaxify-monorepo/issues/152)) ([#168](https://github.com/thalesraymond/galaxify-monorepo/issues/168)) ([5bef262](https://github.com/thalesraymond/galaxify-monorepo/commit/5bef2621681b3c79c0359e0868cc80fc60364fb9))
* **phase-1:** land frontend foundations and Daily/User capabilities ([#146](https://github.com/thalesraymond/galaxify-monorepo/issues/146) [#144](https://github.com/thalesraymond/galaxify-monorepo/issues/144) [#149](https://github.com/thalesraymond/galaxify-monorepo/issues/149) [#147](https://github.com/thalesraymond/galaxify-monorepo/issues/147) [#148](https://github.com/thalesraymond/galaxify-monorepo/issues/148)) ([#167](https://github.com/thalesraymond/galaxify-monorepo/issues/167)) ([2047b68](https://github.com/thalesraymond/galaxify-monorepo/commit/2047b68c7adb3e470e889274baf231c0241df628))
* **web:** complete Phase 1 frontend release gate ([#161](https://github.com/thalesraymond/galaxify-monorepo/issues/161)) ([#181](https://github.com/thalesraymond/galaxify-monorepo/issues/181)) ([7a48942](https://github.com/thalesraymond/galaxify-monorepo/commit/7a489421f27c846400d9e33048765a6b72fca8a5))
* **web:** compose cross-loop Dashboard ([#155](https://github.com/thalesraymond/galaxify-monorepo/issues/155)) ([#180](https://github.com/thalesraymond/galaxify-monorepo/issues/180)) ([ad819f5](https://github.com/thalesraymond/galaxify-monorepo/commit/ad819f5cc087b94666f974ad78c0273b60c54430))
