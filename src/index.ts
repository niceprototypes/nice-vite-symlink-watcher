export type { LinkedPackageMap, SymlinkWatcherOptions } from "./types"
export { getSourceAliases, symlinkWatcher } from "./services"

import { symlinkWatcher } from "./services"

// Default export for convenience
export default symlinkWatcher