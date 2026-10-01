/**
 * demo-preload.cjs — Build Phase 17D Wave A.
 *
 * `seed-demo.ts`/`reset-demo.ts` deliberately import and run the REAL
 * deterministic matching pipeline (`lib/matching/matching-pipeline.ts`,
 * `lib/matching/evidence-bundle.ts`, `lib/matching/gates.ts`) so this
 * demo's seeded gate/score data is a genuine output of real code (see
 * seed-demo.ts's header). Those modules — correctly — start with
 * `import 'server-only'`, which throws unconditionally when required
 * outside a Next.js server compilation, including a plain Node/tsx script.
 *
 * `scripts/seed-staging.ts` never hits this because it only imports TYPE
 * declarations from 'server-only'-guarded modules (erased at compile time),
 * never their runtime code. This wave's scripts need the runtime code
 * itself, so this preload stubs the 'server-only' package with a no-op
 * BEFORE any of those modules load — loaded via `node -r`/`tsx --require`
 * (see the `seed:demo`/`reset:demo` package.json scripts), never modifying
 * the installed 'server-only' package itself.
 */
const Module = require('node:module')
const path = require('node:path')

const serverOnlyPath = require.resolve('server-only')
const stub = new Module(serverOnlyPath)
stub.filename = serverOnlyPath
stub.paths = Module._nodeModulePaths(path.dirname(serverOnlyPath))
stub.loaded = true
stub.exports = {}
require.cache[serverOnlyPath] = stub
