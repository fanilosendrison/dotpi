import { describe, expect, test } from "bun:test";
import { createReadTracker } from "../../../dotagents/agent-hooks/read-deduplicator/src/core/read-tracker";

describe("read-deduplicator / createReadTracker", () => {
  // ── get / track ────────────────────────────────────────────────────────
  test("returns undefined for never-tracked path", () => {
    const t = createReadTracker();
    expect(t.get("/tmp/never.md")).toBeUndefined();
  });

  test("tracks and retrieves fingerprint and turn", () => {
    const t = createReadTracker();
    t.track("/tmp/a.md", "fp-a", 5);
    expect(t.get("/tmp/a.md")).toEqual({ fingerprint: "fp-a", turn: 5 });
  });

  test("overwrites on second track of same path", () => {
    const t = createReadTracker();
    t.track("/tmp/b.md", "fp-v1", 2);
    t.track("/tmp/b.md", "fp-v2", 10);
    expect(t.get("/tmp/b.md")).toEqual({ fingerprint: "fp-v2", turn: 10 });
  });

  // ── independent paths ──────────────────────────────────────────────────
  test("tracks different paths independently", () => {
    const t = createReadTracker();
    t.track("/tmp/x.md", "fp-x", 1);
    t.track("/tmp/y.md", "fp-y", 2);
    expect(t.get("/tmp/x.md")!.fingerprint).toBe("fp-x");
    expect(t.get("/tmp/y.md")!.fingerprint).toBe("fp-y");
  });

  test("get for untracked path among tracked ones returns undefined", () => {
    const t = createReadTracker();
    t.track("/tmp/x.md", "fp-x", 1);
    t.track("/tmp/y.md", "fp-y", 2);
    expect(t.get("/tmp/z.md")).toBeUndefined();
  });
});
