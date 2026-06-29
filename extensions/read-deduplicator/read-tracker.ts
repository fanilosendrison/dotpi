/**
 * Shared read-tracker logic — used by Pi extensions and agent hooks.
 *
 * Tracks which files have been read in a session so that re-reading
 * an identical, still-in-context file can be short-circuited.
 *
 * The `stillInContext` flag is updated externally (by the Pi extension
 * via `before_provider_request` or by the hook via equivalent mechanism).
 * When false, the file is assumed truncated and re-reads are allowed.
 */
export interface TrackEntry {
  fingerprint: string;
  turn: number;
  /** The exact text that was injected into the prompt for this file. */
  injectedText: string;
  /** Whether `injectedText` was found in the most recent provider request payload. */
  stillInContext: boolean;
}

export function createReadTracker() {
  const map = new Map<string, TrackEntry>();

  return {
    /** Look up the tracked entry for a path, or undefined if not yet read. */
    get(path: string): TrackEntry | undefined {
      return map.get(path);
    },

    /** Iterate all tracked entries (for batch `stillInContext` updates). */
    entries(): IterableIterator<[string, TrackEntry]> {
      return map.entries();
    },

    /** Store (or update) the track entry for a path. */
    track(path: string, fingerprint: string, turn: number, injectedText: string): void {
      map.set(path, { fingerprint, turn, injectedText, stillInContext: true });
    },

    /** Mark whether a tracked file's content is still present in the provider payload. */
    setStillInContext(path: string, inContext: boolean): void {
      const entry = map.get(path);
      if (entry) {
        entry.stillInContext = inContext;
      }
    },
  };
}
