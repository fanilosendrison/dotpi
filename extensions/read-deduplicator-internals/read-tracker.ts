/**
 * Shared read-tracker logic — used by Pi extensions and agent hooks.
 *
 * Tracks which files have been read in a session so that re-reading
 * an identical file range can be served from the cached tool result.
 *
 * The `stillInContext` flag is updated externally (by the Pi extension
 * via `before_provider_request` or by the hook via equivalent mechanism).
 * This flag is kept for diagnostics and future telemetry.
 */
export interface TrackEntry {
  fingerprint: string;
  turn: number;
  /** The exact text that was injected into the prompt for this file. */
  injectedText: string;
  /** Whether `injectedText` was found in the most recent provider request payload. */
  stillInContext: boolean;
  /** Line number where the read started, when the read tool used an offset. */
  offset?: number;
  /** Maximum number of lines read, when the read tool used a limit. */
  limit?: number;
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

    /**
     * Return cached text when the file fingerprint and requested line range match.
     */
    getCacheHit(
      path: string,
      fingerprint: string,
      offset?: number,
      limit?: number,
    ): string | undefined {
      const entry = map.get(path);
      if (!entry) return undefined;
      if (entry.fingerprint !== fingerprint) return undefined;
      if (entry.offset !== offset) return undefined;
      if (entry.limit !== limit) return undefined;
      return entry.injectedText;
    },

    /** Store (or update) the track entry for a path. */
    track(
      path: string,
      fingerprint: string,
      turn: number,
      injectedText: string,
      offset?: number,
      limit?: number,
    ): void {
      map.set(path, {
        fingerprint,
        turn,
        injectedText,
        stillInContext: true,
        offset,
        limit,
      });
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
