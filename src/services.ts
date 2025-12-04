import type { Plugin, ViteDevServer } from "vite"
import { join } from "path"
import { existsSync } from "fs"
import type {
  LinkedPackageMap,
  SymlinkWatcherOptions,
  PackageInfo,
  KeyedDebouncer,
} from "./types"

/**
 * Generates source aliases for packages that support direct source imports.
 *
 * Use this for packages that don't require special build transforms.
 * These packages will get true HMR with state preservation since Vite
 * can directly watch and process the source files.
 *
 * @param packages - Map of package names to their local filesystem paths
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
  // Build a map of package names to their source entry points
  const aliases: Record<string, string> = {}

  for (const pkgName of aliasablePackages) {
    const pkgPath = packages[pkgName]
    if (pkgPath) {
      // Point to the source entry file instead of the dist output
      aliases[pkgName] = join(pkgPath, "src", entryPoint)
    }
  }

  return aliases
}

/**
 * Registers watch directories with Vite's file watcher.
 *
 * Iterates through all configured packages and adds their watch directories
 * (typically 'dist') to Vite's chokidar file watcher. Only adds directories
 * that actually exist on the filesystem.
 *
 * @param server - The Vite dev server instance
 * @param packages - Map of package names to their local filesystem paths
 * @param watchDir - Subdirectory within each package to watch (e.g., 'dist')
 */
export function registerWatchers(
  server: ViteDevServer,
  packages: LinkedPackageMap,
  watchDir: string
): void {
  for (const pkgPath of Object.values(packages)) {
    // Construct the full path to the watch directory
    const targetPath = join(pkgPath, watchDir)

    // Only add the watcher if the directory exists
    if (existsSync(targetPath)) {
      server.watcher.add(targetPath)
    }
  }
}

/**
 * Checks if a file path belongs to a watched package directory.
 *
 * Given a file path from a file change event, determines which package
 * (if any) the file belongs to by checking if the path starts with
 * any of the configured package watch directories.
 *
 * @param filePath - The absolute path of the changed file
 * @param packages - Map of package names to their local filesystem paths
 * @param watchDir - Subdirectory within each package being watched
 * @returns Package info if the file belongs to a watched package, undefined otherwise
 */
export function getPackageForPath(
  filePath: string,
  packages: LinkedPackageMap,
  watchDir: string
): PackageInfo | undefined {
  for (const [pkgName, pkgPath] of Object.entries(packages)) {
    // Construct the full path to the watch directory
    const targetPath = join(pkgPath, watchDir)

    // Check if the changed file is within this package's watch directory
    if (filePath.startsWith(targetPath)) {
      return { name: pkgName, path: pkgPath }
    }
  }

  // File doesn't belong to any watched package
  return undefined
}

/**
 * Invalidates all modules from a specific package in Vite's module graph.
 *
 * Searches through Vite's module graph and invalidates any modules that
 * either have URLs containing the package name or have file paths within
 * the package directory. This ensures that all cached modules from the
 * package are marked as stale and will be re-fetched.
 *
 * @param server - The Vite dev server instance
 * @param pkgName - Name of the package to invalidate
 * @param pkgPath - Filesystem path to the package
 * @returns The number of modules that were invalidated
 */
export function invalidatePackageModules(
  server: ViteDevServer,
  pkgName: string,
  pkgPath: string
): number {
  const { moduleGraph } = server
  let count = 0

  // Iterate through all modules in the graph
  for (const [url, mod] of moduleGraph.urlToModuleMap) {
    // Check if the module URL contains the package name
    // or if the module's file path is within the package directory
    if (mod && (url.includes(pkgName) || mod.file?.includes(pkgPath))) {
      // Mark the module as invalidated so it will be re-fetched
      moduleGraph.invalidateModule(mod)
      count++
    }
  }

  return count
}

/**
 * Creates a keyed debouncer that batches calls by key.
 *
 * Each key gets its own independent debounce timer. This is useful for
 * debouncing file change events per-package, so that rapid changes to
 * one package don't affect the debounce timing for another package.
 *
 * @param delay - Debounce delay in milliseconds
 * @returns A keyed debouncer instance with a call() method
 */
export function createKeyedDebouncer(delay: number): KeyedDebouncer {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const counts = new Map<string, number>()

  return {
    call(key: string, fn: (count: number) => void): void {
      // Increment the count for this key
      counts.set(key, (counts.get(key) || 0) + 1)

      // Cancel any existing timer for this key
      const existing = timers.get(key)
      if (existing) {
        clearTimeout(existing)
      }

      // Set a new timer
      const timer = setTimeout(() => {
        const count = counts.get(key) || 1
        timers.delete(key)
        counts.delete(key)
        fn(count)
      }, delay)

      timers.set(key, timer)
    },
  }
}

/**
 * Vite plugin that watches symlinked package dist folders for changes.
 *
 * This plugin enables hot-reloading for npm-linked packages by:
 * 1. Adding dist folders to Vite's file watcher
 * 2. Detecting changes when the package's build process outputs new files
 * 3. Invalidating affected modules in Vite's module graph
 * 4. Triggering a browser reload to reflect the changes
 *
 * The plugin uses debouncing to batch rapid file changes (common during
 * build processes) into a single reload event.
 *
 * @param options - Plugin configuration options
 * @returns A Vite plugin instance
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
  const { packages, watchDir = "dist", verbose = false, debounce = 300 } = options
  const debouncer = createKeyedDebouncer(debounce)

  return {
    name: "vite-plugin-symlink-watcher",

    configureServer(server) {
      registerWatchers(server, packages, watchDir)

      if (verbose) {
        const pkgNames = Object.keys(packages).join(", ")
        console.log(`[symlink-watcher] Watching ${watchDir}/ in: ${pkgNames}`)
      }

      server.watcher.on("change", (filePath) => {
        const pkg = getPackageForPath(filePath, packages, watchDir)
        if (!pkg) return

        debouncer.call(pkg.name, (fileCount) => {
          const invalidatedCount = invalidatePackageModules(
            server,
            pkg.name,
            pkg.path
          )

          if (verbose) {
            const files = fileCount === 1 ? "file" : "files"
            console.log(
              `[symlink-watcher] ${pkg.name} changed (${fileCount} ${files}), invalidated ${invalidatedCount} modules`
            )
          }

          server.ws.send({ type: "full-reload" })
        })
      })
    },
  }
}