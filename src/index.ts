import type { Plugin, ViteDevServer } from "vite"
import { join } from "path"
import { existsSync } from "fs"

/**
 * Map of package names to their local filesystem paths
 */
export type LinkedPackageMap = Record<string, string>

/**
 * Options for the symlink watcher plugin
 */
export interface SymlinkWatcherOptions {
  /**
   * Map of package names to their local filesystem paths
   *
   * @example
   * ```typescript
   * {
   *   'my-ui-library': '/Users/me/code/my-ui-library',
   *   'my-utils': '/Users/me/code/my-utils',
   * }
   * ```
   */
  packages: LinkedPackageMap

  /**
   * Subdirectory to watch within each package (default: 'dist')
   */
  watchDir?: string

  /**
   * Whether to log when changes are detected (default: false)
   */
  verbose?: boolean
}

/**
 * Generates source aliases for packages that support direct source imports
 *
 * Use this for packages that don't require special build transforms.
 * These packages will get true HMR with state preservation.
 *
 * @param packages - Map of package names to their local paths
 * @param aliasablePackages - List of package names that can use source aliases
 * @param entryPoint - Entry point file within src/ (default: 'index.ts')
 * @returns Record of package names to their source entry points
 *
 * @example
 * ```typescript
 * import { getSourceAliases } from 'vite-plugin-symlink-watcher'
 *
 * const packages = {
 *   'my-ui-library': '/Users/me/code/my-ui-library',
 *   'my-icon-library': '/Users/me/code/my-icon-library', // uses SVGR
 * }
 *
 * // Only alias packages without special build transforms
 * const aliases = getSourceAliases(packages, ['my-ui-library'])
 *
 * // In vite.config.ts:
 * export default {
 *   resolve: {
 *     alias: {
 *       ...aliases,
 *     }
 *   }
 * }
 * ```
 */
export function getSourceAliases(
  packages: LinkedPackageMap,
  aliasablePackages: string[],
  entryPoint: string = "index.ts"
): Record<string, string> {
  const aliases: Record<string, string> = {}

  for (const pkgName of aliasablePackages) {
    const pkgPath = packages[pkgName]
    if (pkgPath) {
      aliases[pkgName] = join(pkgPath, "src", entryPoint)
    }
  }

  return aliases
}

/**
 * Registers watch directories with Vite's file watcher
 */
function registerWatchers(
  server: ViteDevServer,
  packages: LinkedPackageMap,
  watchDir: string
): void {
  for (const pkgPath of Object.values(packages)) {
    const targetPath = join(pkgPath, watchDir)
    if (existsSync(targetPath)) {
      server.watcher.add(targetPath)
    }
  }
}

/**
 * Checks if a file path belongs to a watched package directory
 */
function getPackageForPath(
  filePath: string,
  packages: LinkedPackageMap,
  watchDir: string
): { name: string; path: string } | undefined {
  for (const [pkgName, pkgPath] of Object.entries(packages)) {
    const targetPath = join(pkgPath, watchDir)
    if (filePath.startsWith(targetPath)) {
      return { name: pkgName, path: pkgPath }
    }
  }
  return undefined
}

/**
 * Invalidates all modules from a specific package in Vite's module graph
 */
function invalidatePackageModules(
  server: ViteDevServer,
  pkgName: string,
  pkgPath: string
): number {
  const { moduleGraph } = server
  let count = 0

  for (const [url, mod] of moduleGraph.urlToModuleMap) {
    if (mod && (url.includes(pkgName) || mod.file?.includes(pkgPath))) {
      moduleGraph.invalidateModule(mod)
      count++
    }
  }

  return count
}

/**
 * Vite plugin that watches symlinked package dist folders for changes
 *
 * This plugin enables hot-reloading for npm-linked packages by:
 * 1. Adding dist folders to Vite's file watcher
 * 2. Detecting changes when the package's build process outputs new files
 * 3. Invalidating affected modules in Vite's module graph
 * 4. Triggering a browser reload to reflect the changes
 *
 * @param options - Plugin configuration
 * @returns A Vite plugin
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { symlinkWatcher } from 'vite-plugin-symlink-watcher'
 *
 * export default {
 *   plugins: [
 *     symlinkWatcher({
 *       packages: {
 *         'my-ui-library': '/Users/me/code/my-ui-library',
 *         'my-utils': '/Users/me/code/my-utils',
 *       },
 *       verbose: true,
 *     }),
 *   ],
 * }
 * ```
 */
export function symlinkWatcher(options: SymlinkWatcherOptions): Plugin {
  const { packages, watchDir = "dist", verbose = false } = options

  return {
    name: "vite-plugin-symlink-watcher",

    configureServer(server) {
      // Register all watch directories with the file watcher
      registerWatchers(server, packages, watchDir)

      if (verbose) {
        const pkgNames = Object.keys(packages).join(", ")
        console.log(`[symlink-watcher] Watching ${watchDir}/ in: ${pkgNames}`)
      }

      // Listen for file changes
      server.watcher.on("change", (filePath) => {
        const pkg = getPackageForPath(filePath, packages, watchDir)

        if (pkg) {
          // Invalidate all modules from this package
          const invalidatedCount = invalidatePackageModules(
            server,
            pkg.name,
            pkg.path
          )

          if (verbose) {
            console.log(
              `[symlink-watcher] ${pkg.name} changed, invalidated ${invalidatedCount} modules`
            )
          }

          // Trigger full reload since HMR boundaries may not be set up
          // for external package changes
          server.ws.send({ type: "full-reload" })
        }
      })
    },
  }
}

// Default export for convenience
export default symlinkWatcher