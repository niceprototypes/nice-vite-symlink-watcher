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

  /**
   * Debounce delay in milliseconds (default: 300)
   *
   * When multiple file changes occur within this window, only one
   * reload is triggered. This prevents reload storms during builds.
   */
  debounce?: number
}

/**
 * Package info returned when a file path matches a watched package
 */
export interface PackageInfo {
  name: string
  path: string
}

/**
 * Keyed debouncer instance for batching calls by key
 */
export interface KeyedDebouncer {
  /**
   * Schedule a function to be called after the debounce delay.
   * @param key - Unique identifier for this debounce group
   * @param fn - Callback receiving the count of batched calls
   */
  call(key: string, fn: (count: number) => void): void
}