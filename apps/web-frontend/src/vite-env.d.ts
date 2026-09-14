/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Browser-visible mock journey scenario for `npm run dev:mock` (issue #136). */
  readonly VITE_MOCK_SCENARIO?: string
}
