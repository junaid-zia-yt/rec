// Metro config for the pnpm-workspace monorepo. Expo's default Metro config
// only watches this package's own directory; a monorepo needs the repo root
// added as a watch folder and node_modules resolution widened to include
// the root's node_modules (where pnpm hoists shared deps like React) so
// that `@rqi/types` (resolved via the workspace symlink) and any hoisted
// package are found correctly.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
// pnpm uses symlinks for workspace packages; without this Metro tries to
// resolve haste/symlink targets in ways that break on a pnpm store layout.
config.resolver.disableHierarchicalLookup = true
config.resolver.unstable_enableSymlinks = true

module.exports = config
