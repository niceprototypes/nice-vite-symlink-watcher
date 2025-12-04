# nice-vite-symlink-watcher

**Hot-reload symlinked npm packages in Vite** — automatically detect changes in linked package dist folders and trigger browser reload.

[![npm version](https://img.shields.io/npm/v/nice-vite-symlink-watcher.svg)](https://www.npmjs.com/package/nice-vite-symlink-watcher)
[![license](https://img.shields.io/npm/l/nice-vite-symlink-watcher.svg)](https://github.com/niceprototypes/nice-vite-symlink-watcher/blob/main/LICENSE)

## The Problem

When developing multiple npm packages locally with `npm link` or `file:` dependencies, Vite's dev server doesn't detect changes in the linked packages. You're forced to restart the entire dev server every time you modify a linked package.

**Common symptoms:**
- Changes to linked packages don't appear in the browser
- `preserveSymlinks: false` doesn't help
- `server.watch.followSymlinks: true` doesn't help
- `optimizeDeps.exclude` prevents pre-bundling but doesn't enable watching
- You find yourself restarting `npm run dev` constantly

## Why Existing Solutions Fall Short

| Approach | Limitation |
|----------|------------|
| **Source aliases** (`resolve.alias`) | Only works for packages without build transforms (SVGR, PostCSS, etc.) |
| **`preserveSymlinks: false`** | Helps with resolution, not watching |
| **`optimizeDeps.exclude`** | Prevents pre-bundling, doesn't add watching |
| **Workspace plugins** | Designed for monorepos, trigger rebuilds rather than watch dist |

## The Solution

This plugin fills a specific gap: **watching the `dist` folder of linked packages** that require their own build pipeline (TypeScript, SVGR, PostCSS, etc.).

It works alongside source aliases — use source aliases for simple packages (true HMR), and this plugin for packages with build transforms.

## Installation

```bash
npm install -D nice-vite-symlink-watcher
```

## Quick Start

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { symlinkWatcher } from 'nice-vite-symlink-watcher'

export default defineConfig({
  plugins: [
    symlinkWatcher({
      packages: {
        'my-ui-library': '/Users/me/code/my-ui-library',
        'my-icon-library': '/Users/me/code/my-icon-library',
      },
      verbose: true, // Log when changes are detected
    }),
  ],
})
```

## Combining with Source Aliases (Recommended)

For the best development experience, use **source aliases** for packages without special build transforms, and **dist watching** for packages that need their build pipeline.

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { symlinkWatcher, getSourceAliases } from 'nice-vite-symlink-watcher'

// All your linked packages
const linkedPackages = {
  'my-ui-library': '/Users/me/code/my-ui-library',
  'my-icon-library': '/Users/me/code/my-icon-library', // Uses SVGR
  'my-utils': '/Users/me/code/my-utils',
}

// Packages that can use source aliases (no special build transforms)
// These get TRUE HMR with state preservation
const sourceAliasable = ['my-ui-library', 'my-utils']

export default defineConfig({
  plugins: [
    // Watch dist folders for ALL packages (catches non-aliased ones)
    symlinkWatcher({
      packages: linkedPackages,
      verbose: true,
    }),
  ],
  resolve: {
    alias: {
      // Source aliases for packages without build transforms
      ...getSourceAliases(linkedPackages, sourceAliasable),
    },
  },
  optimizeDeps: {
    // Prevent Vite from pre-bundling linked packages
    exclude: Object.keys(linkedPackages),
  },
})
```

### Why Both?

| Package Type | Strategy | HMR Behavior |
|-------------|----------|--------------|
| Simple TypeScript/React | Source alias → `src/index.ts` | **True HMR** — state preserved |
| Uses SVGR, PostCSS, etc. | Dist watching | **Full reload** — but automatic |

## API

### `symlinkWatcher(options)`

Creates the Vite plugin.

```typescript
interface SymlinkWatcherOptions {
  /**
   * Map of package names to their local filesystem paths
   */
  packages: Record<string, string>

  /**
   * Subdirectory to watch within each package (default: 'dist')
   */
  watchDir?: string

  /**
   * Whether to log when changes are detected (default: false)
   * Logs include the number of file changes batched and modules invalidated:
   * [symlink-watcher] my-package changed (12 files), invalidated 3 modules
   */
  verbose?: boolean

  /**
   * Debounce delay in milliseconds (default: 300)
   * Batches rapid file changes into a single reload to prevent reload storms
   * during builds that output multiple files.
   */
  debounce?: number
}
```

### `getSourceAliases(packages, aliasablePackages, entryPoint?)`

Generates Vite resolve aliases pointing to package source files.

```typescript
const aliases = getSourceAliases(
  linkedPackages,           // All packages
  ['my-ui-library'],        // Only these get aliased
  'index.ts'                // Entry point within src/ (default)
)
// Returns: { 'my-ui-library': '/Users/me/code/my-ui-library/src/index.ts' }
```

## How It Works

1. **Registration**: On server start, adds each package's `dist` folder to Vite's file watcher
2. **Detection**: When a file changes in a watched dist folder, identifies which package changed
3. **Debouncing**: Batches rapid file changes (common during builds) into a single reload event
4. **Invalidation**: Clears affected modules from Vite's module graph cache
5. **Reload**: Sends a full-reload signal to the browser

```
Developer edits source → Package build runs → dist/ updates → Plugin debounces → Browser reloads once
```

## Use Cases

- **Component library development**: Edit your UI library, see changes in the consuming app
- **Monorepo-like setups**: Work on multiple related packages without publishing
- **Design system development**: Iterate on shared components across applications
- **Package testing**: Test changes before publishing to npm

## Storybook Integration

Works great with Storybook's Vite builder:

```typescript
// .storybook/main.ts
import { symlinkWatcher, getSourceAliases } from 'nice-vite-symlink-watcher'

const config: StorybookConfig = {
  // ...
  viteFinal: async (config) => {
    config.plugins = [
      ...(config.plugins || []),
      symlinkWatcher({
        packages: linkedPackages,
        verbose: true,
      }),
    ]
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...getSourceAliases(linkedPackages, sourceAliasable),
    }
    return config
  },
}
```

## Limitations

- **Full page reload**: Packages watched via dist (not source-aliased) trigger full reloads, not granular HMR. This is because dist files don't contain HMR boundary information.
- **Build pipeline delay**: You need to wait for the linked package's build to complete before changes appear.
- **React state**: Full reloads reset React component state. For state-sensitive development, prefer source aliases when possible.

## FAQ

### Why not just use source aliases for everything?

Source aliases work by importing directly from a package's `src/` folder. This bypasses the package's build pipeline, which breaks packages that use:

- **SVGR** — transforms SVG imports to React components
- **PostCSS/Tailwind** — processes CSS
- **Custom Babel plugins** — transforms code in ways Vite doesn't replicate
- **Asset processing** — handles images, fonts, etc.

### Does this work with pnpm/yarn workspaces?

Yes. While workspaces have some built-in linking, they still benefit from explicit dist watching for packages with build transforms.

### Why full reload instead of HMR?

HMR requires modules to define "HMR boundaries" — code that tells Vite how to hot-swap the module. Built dist files don't include this boundary code (it's stripped during production builds). Without boundaries, Vite correctly falls back to a full reload.

## Related

- [vite-plugin-watch-workspace](https://github.com/nicerprototypes/vite-plugin-watch-workspace) — Different approach: triggers package rebuilds
- [Vite Issue #819](https://github.com/vitejs/vite/issues/819) — Original discussion on symlink handling

## License

MIT
