import { defineConfig } from '@hey-api/openapi-ts'

// Generate wire types and schemas only. Feature adapters own operations and
// query semantics; the transport owns HTTP behavior.
export default defineConfig({
  input: [
    '../../docs/openapi/user-service.yaml',
    '../../docs/openapi/daily-service.yaml',
    '../../docs/openapi/ship-service.yaml',
    '../../docs/openapi/expedition-service.yaml',
  ],
  output: [
    'src/api/generated/user',
    'src/api/generated/daily',
    'src/api/generated/ship',
    'src/api/generated/expedition',
  ],
  plugins: ['@hey-api/typescript', 'zod'],
})
