# Phase 5 — Governance: Selective Settings Push

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow team admins to push plugin settings to members with Default (opt-out) and Enforced (locked) modes.

**Architecture:** A `TeamSettingsStore` manages `team:settings:<pluginId>` CouchDB documents. When these arrive via replication, `TeamSettingsApplier` applies them — enforced values overwrite local settings unconditionally; default values apply only if the member hasn't customized (tracked by `TeamOverrideTracker` in local SimpleStore). The admin manages pushed settings through a Svelte component mounted in the Team Management settings section.

**Tech Stack:** PouchDB (allDocs prefix queries), SimpleStore (IndexedDB), Svelte 5 (runes), Obsidian Setting API, LiveSyncSetting addOnUpdate pattern.

**Reference files:**
- `src/modules/features/TeamSync/types.ts` — TeamSettingsEntry type (lines 22-31)
- `src/modules/features/TeamSync/AnnotationStore.ts` — Store pattern reference
- `src/modules/features/TeamSync/ReadStateManager.ts` — SimpleStore wrapper pattern
- `src/modules/features/TeamSync/ModuleTeamSync.ts` — Module integration point
- `src/modules/features/TeamSync/events.ts` — Event declarations
- `src/modules/features/SettingDialogue/SettingPane.ts` — `enableOnly`, `visibleOnly`, `OnUpdateResult`
- `src/modules/features/SettingDialogue/LiveSyncSetting.ts` — `addOnUpdate`, `_applyOnUpdateHandlers`
- `src/lib/src/events/coreEvents.ts` — `EVENT_SETTING_SAVED`

---

### Task 1: TeamSettingsStore

CRUD for `team:settings:*` CouchDB documents. Follows the AnnotationStore pattern.

**Files:**
- Create: `src/modules/features/TeamSync/TeamSettingsStore.ts`
- Test: `test/unit/team-phase5.test.ts`

**Step 1: Write the failing tests**

Create `test/unit/team-phase5.test.ts` with a mock DB (same pattern as `team-phase4.test.ts`):

```typescript
import { describe, it, expect, beforeEach } from "vitest";

function createMockDB() {
    const docs = new Map<string, any>();
    return {
        get: async (id: string) => {
            const doc = docs.get(id);
            if (!doc) throw { status: 404 };
            return { ...doc };
        },
        put: async (doc: any) => {
            const rev = `${(parseInt((docs.get(doc._id)?._rev ?? "0").split("-")[0]) || 0) + 1}-mock`;
            docs.set(doc._id, { ...doc, _rev: rev });
            return { ok: true, id: doc._id, rev };
        },
        allDocs: async (opts: any) => {
            const rows: any[] = [];
            for (const [id, doc] of docs.entries()) {
                if (opts.startkey && id < opts.startkey) continue;
                if (opts.endkey && id > opts.endkey) continue;
                if ((doc as any)._deleted) continue;
                rows.push({ id, doc: opts.include_docs ? doc : undefined });
            }
            return { rows };
        },
    };
}

describe("TeamSettingsStore", () => {
    let store: any;
    let mockDB: any;

    beforeEach(async () => {
        const { TeamSettingsStore } = await import(
            "../../src/modules/features/TeamSync/TeamSettingsStore"
        );
        mockDB = createMockDB();
        store = new TeamSettingsStore({ localDatabase: mockDB } as any);
    });

    it("should save and retrieve a settings entry", async () => {
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                liveSync: { value: true, mode: "enforced" as const },
                syncOnStart: { value: false, mode: "default" as const },
            },
        };
        await store.saveEntry(entry);
        const fetched = await store.getEntry("self-hosted-livesync");
        expect(fetched).not.toBeNull();
        expect(fetched!.managedBy).toBe("alice");
        expect(fetched!.settings.liveSync.mode).toBe("enforced");
    });

    it("should return null for missing entry", async () => {
        const result = await store.getEntry("nonexistent-plugin");
        expect(result).toBeNull();
    });

    it("should list all settings entries", async () => {
        await store.saveEntry({
            _id: "team:settings:plugin-a" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: { foo: { value: 1, mode: "default" as const } },
        });
        await store.saveEntry({
            _id: "team:settings:plugin-b" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: { bar: { value: 2, mode: "enforced" as const } },
        });
        const all = await store.getAllEntries();
        expect(all.length).toBe(2);
    });

    it("should update an existing entry preserving _rev", async () => {
        await store.saveEntry({
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: "2026-01-01T00:00:00Z",
            settings: { liveSync: { value: true, mode: "default" as const } },
        });
        const first = await store.getEntry("self-hosted-livesync");
        // Update with new settings
        first!.settings.liveSync.mode = "enforced";
        first!.updatedAt = "2026-02-01T00:00:00Z";
        await store.saveEntry(first!);
        const updated = await store.getEntry("self-hosted-livesync");
        expect(updated!.settings.liveSync.mode).toBe("enforced");
        expect(updated!.updatedAt).toBe("2026-02-01T00:00:00Z");
    });

    it("should remove a setting key from an entry", async () => {
        await store.saveEntry({
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                liveSync: { value: true, mode: "enforced" as const },
                syncOnStart: { value: false, mode: "default" as const },
            },
        });
        await store.removeSetting("self-hosted-livesync", "syncOnStart");
        const fetched = await store.getEntry("self-hosted-livesync");
        expect(fetched!.settings.syncOnStart).toBeUndefined();
        expect(fetched!.settings.liveSync).toBeDefined();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: FAIL — module not found

**Step 3: Write TeamSettingsStore**

Create `src/modules/features/TeamSync/TeamSettingsStore.ts`:

```typescript
import type { LiveSyncLocalDB } from "../../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import type { TeamSettingsEntry } from "./types.ts";

export class TeamSettingsStore {
    constructor(private db: LiveSyncLocalDB) {}

    async getEntry(pluginId: string): Promise<TeamSettingsEntry | null> {
        try {
            const doc = await this.db.localDatabase.get(`team:settings:${pluginId}`);
            if ((doc as any)._deleted) return null;
            return doc as unknown as TeamSettingsEntry;
        } catch {
            return null;
        }
    }

    async getAllEntries(): Promise<TeamSettingsEntry[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:settings:",
            endkey: "team:settings:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as TeamSettingsEntry)
            .filter((e) => e && !(e as any)._deleted);
    }

    async saveEntry(entry: TeamSettingsEntry): Promise<void> {
        // Fetch current _rev if not present
        if (!entry._rev) {
            try {
                const existing = await this.db.localDatabase.get(entry._id);
                entry._rev = (existing as any)._rev;
            } catch {
                // New document, no _rev needed
            }
        }
        await this.db.localDatabase.put(entry as any);
    }

    async removeSetting(pluginId: string, settingKey: string): Promise<boolean> {
        const entry = await this.getEntry(pluginId);
        if (!entry) return false;
        delete entry.settings[settingKey];
        await this.db.localDatabase.put(entry as any);
        return true;
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: 5 PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/TeamSettingsStore.ts test/unit/team-phase5.test.ts
git commit -m "feat(team): add TeamSettingsStore for settings entry CRUD"
```

---

### Task 2: TeamOverrideTracker

Tracks which team-default settings a member has intentionally customized. Uses SimpleStore (local IndexedDB, not synced). Follows ReadStateManager pattern.

**Files:**
- Create: `src/modules/features/TeamSync/TeamOverrideTracker.ts`
- Modify: `test/unit/team-phase5.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/team-phase5.test.ts`:

```typescript
describe("TeamOverrideTracker", () => {
    let tracker: any;

    beforeEach(async () => {
        const { TeamOverrideTracker } = await import(
            "../../src/modules/features/TeamSync/TeamOverrideTracker"
        );
        // Mock SimpleStore
        const data = new Map<string, any>();
        const mockStore = {
            get: async (key: string) => data.get(key),
            set: async (key: string, value: any) => { data.set(key, value); },
            delete: async (key: string) => { data.delete(key); },
        };
        tracker = new TeamOverrideTracker(mockStore as any);
    });

    it("should report no overrides initially", async () => {
        const result = await tracker.isOverridden("self-hosted-livesync", "liveSync");
        expect(result).toBe(false);
    });

    it("should mark and detect an override", async () => {
        await tracker.markOverridden("self-hosted-livesync", "liveSync");
        expect(await tracker.isOverridden("self-hosted-livesync", "liveSync")).toBe(true);
        expect(await tracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(false);
    });

    it("should clear a single override", async () => {
        await tracker.markOverridden("self-hosted-livesync", "liveSync");
        await tracker.markOverridden("self-hosted-livesync", "syncOnStart");
        await tracker.clearOverride("self-hosted-livesync", "liveSync");
        expect(await tracker.isOverridden("self-hosted-livesync", "liveSync")).toBe(false);
        expect(await tracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(true);
    });

    it("should list all overrides for a plugin", async () => {
        await tracker.markOverridden("self-hosted-livesync", "a");
        await tracker.markOverridden("self-hosted-livesync", "b");
        const overrides = await tracker.getOverrides("self-hosted-livesync");
        expect(overrides).toEqual(expect.arrayContaining(["a", "b"]));
        expect(overrides.length).toBe(2);
    });

    it("should clear all overrides for a plugin", async () => {
        await tracker.markOverridden("self-hosted-livesync", "a");
        await tracker.markOverridden("self-hosted-livesync", "b");
        await tracker.clearAllOverrides("self-hosted-livesync");
        const overrides = await tracker.getOverrides("self-hosted-livesync");
        expect(overrides.length).toBe(0);
    });

    it("should handle multiple plugins independently", async () => {
        await tracker.markOverridden("plugin-a", "setting1");
        await tracker.markOverridden("plugin-b", "setting2");
        expect(await tracker.isOverridden("plugin-a", "setting1")).toBe(true);
        expect(await tracker.isOverridden("plugin-a", "setting2")).toBe(false);
        expect(await tracker.isOverridden("plugin-b", "setting2")).toBe(true);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: TeamOverrideTracker tests FAIL — module not found

**Step 3: Write TeamOverrideTracker**

Create `src/modules/features/TeamSync/TeamOverrideTracker.ts`:

```typescript
import type { SimpleStore } from "../../../lib/src/common/types.ts";

interface OverrideRecord {
    overridden: string[];
}

export class TeamOverrideTracker {
    constructor(private store: SimpleStore<OverrideRecord>) {}

    async isOverridden(pluginId: string, settingKey: string): Promise<boolean> {
        const record = await this.store.get(pluginId);
        if (!record) return false;
        return record.overridden.includes(settingKey);
    }

    async markOverridden(pluginId: string, settingKey: string): Promise<void> {
        const record = await this.store.get(pluginId) ?? { overridden: [] };
        if (!record.overridden.includes(settingKey)) {
            record.overridden.push(settingKey);
            await this.store.set(pluginId, record);
        }
    }

    async clearOverride(pluginId: string, settingKey: string): Promise<void> {
        const record = await this.store.get(pluginId);
        if (!record) return;
        record.overridden = record.overridden.filter((k) => k !== settingKey);
        await this.store.set(pluginId, record);
    }

    async getOverrides(pluginId: string): Promise<string[]> {
        const record = await this.store.get(pluginId);
        return record?.overridden ?? [];
    }

    async clearAllOverrides(pluginId: string): Promise<void> {
        await this.store.set(pluginId, { overridden: [] });
    }
}
```

**Note:** Check the actual `SimpleStore` import path. It may be in `octagonal-wheels` or `../../../lib/src/common/types.ts`. Search for `SimpleStore` interface/type to find the correct import. If no named export exists, define the interface locally:

```typescript
interface SimpleStore<T> {
    get(key: string): Promise<T | undefined>;
    set(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: All TeamOverrideTracker tests PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/TeamOverrideTracker.ts test/unit/team-phase5.test.ts
git commit -m "feat(team): add TeamOverrideTracker for local override tracking"
```

---

### Task 3: TeamSettingsApplier

Pure logic class that applies team settings to local plugin settings. This is the core governance engine.

**Files:**
- Create: `src/modules/features/TeamSync/TeamSettingsApplier.ts`
- Modify: `test/unit/team-phase5.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/team-phase5.test.ts`:

```typescript
describe("TeamSettingsApplier", () => {
    let applier: any;
    let overrideTracker: any;

    beforeEach(async () => {
        const { TeamSettingsApplier } = await import(
            "../../src/modules/features/TeamSync/TeamSettingsApplier"
        );
        const { TeamOverrideTracker } = await import(
            "../../src/modules/features/TeamSync/TeamOverrideTracker"
        );
        const data = new Map<string, any>();
        const mockStore = {
            get: async (key: string) => data.get(key),
            set: async (key: string, value: any) => { data.set(key, value); },
            delete: async (key: string) => { data.delete(key); },
        };
        overrideTracker = new TeamOverrideTracker(mockStore as any);
        applier = new TeamSettingsApplier(overrideTracker);
    });

    it("should apply enforced settings unconditionally", async () => {
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                liveSync: { value: true, mode: "enforced" as const },
            },
        };
        const current = { liveSync: false, otherSetting: "keep" };
        const result = await applier.apply(entry, current);
        expect(result.applied.liveSync).toBe(true);
        expect(result.applied.otherSetting).toBe("keep");
        expect(result.enforced).toContain("liveSync");
    });

    it("should apply default settings when not overridden", async () => {
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                syncOnStart: { value: true, mode: "default" as const },
            },
        };
        const current = { syncOnStart: false };
        const result = await applier.apply(entry, current);
        expect(result.applied.syncOnStart).toBe(true);
        expect(result.enforced).not.toContain("syncOnStart");
    });

    it("should skip default settings when member has overridden", async () => {
        await overrideTracker.markOverridden("self-hosted-livesync", "syncOnStart");
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                syncOnStart: { value: true, mode: "default" as const },
            },
        };
        const current = { syncOnStart: false };
        const result = await applier.apply(entry, current);
        expect(result.applied.syncOnStart).toBe(false); // Member's value preserved
    });

    it("should enforce even if member has overridden", async () => {
        await overrideTracker.markOverridden("self-hosted-livesync", "liveSync");
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                liveSync: { value: true, mode: "enforced" as const },
            },
        };
        const current = { liveSync: false };
        const result = await applier.apply(entry, current);
        expect(result.applied.liveSync).toBe(true); // Enforced wins
    });

    it("should return list of enforced keys", async () => {
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                liveSync: { value: true, mode: "enforced" as const },
                syncOnStart: { value: true, mode: "default" as const },
                batchSave: { value: false, mode: "enforced" as const },
            },
        };
        const current = { liveSync: false, syncOnStart: false, batchSave: true };
        const result = await applier.apply(entry, current);
        expect(result.enforced).toEqual(expect.arrayContaining(["liveSync", "batchSave"]));
        expect(result.enforced).not.toContain("syncOnStart");
    });

    it("should detect when member customizes a default setting", async () => {
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                syncOnStart: { value: true, mode: "default" as const },
            },
        };
        // Member changes syncOnStart to false
        await applier.detectCustomization(entry, "syncOnStart", false);
        expect(await overrideTracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(true);
    });

    it("should not mark as override when value matches team default", async () => {
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                syncOnStart: { value: true, mode: "default" as const },
            },
        };
        // Member sets syncOnStart to true (same as team default)
        await applier.detectCustomization(entry, "syncOnStart", true);
        expect(await overrideTracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(false);
    });

    it("should clear override when member resets to team default", async () => {
        await overrideTracker.markOverridden("self-hosted-livesync", "syncOnStart");
        const entry = {
            _id: "team:settings:self-hosted-livesync" as const,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                syncOnStart: { value: true, mode: "default" as const },
            },
        };
        await applier.detectCustomization(entry, "syncOnStart", true);
        expect(await overrideTracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(false);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: TeamSettingsApplier tests FAIL

**Step 3: Write TeamSettingsApplier**

Create `src/modules/features/TeamSync/TeamSettingsApplier.ts`:

```typescript
import type { TeamSettingsEntry } from "./types.ts";
import type { TeamOverrideTracker } from "./TeamOverrideTracker.ts";

export interface ApplyResult {
    /** The settings object with team values applied */
    applied: Record<string, unknown>;
    /** Setting keys that are enforced (should be locked in UI) */
    enforced: string[];
}

export class TeamSettingsApplier {
    constructor(private overrideTracker: TeamOverrideTracker) {}

    /**
     * Apply a team settings entry to a local settings object.
     * - Enforced: always overwrites, regardless of overrides
     * - Default: applies only if member hasn't customized
     */
    async apply(entry: TeamSettingsEntry, currentSettings: Record<string, unknown>): Promise<ApplyResult> {
        const applied = { ...currentSettings };
        const enforced: string[] = [];
        const pluginId = entry._id.replace("team:settings:", "");

        for (const [key, spec] of Object.entries(entry.settings)) {
            if (spec.mode === "enforced") {
                applied[key] = spec.value;
                enforced.push(key);
            } else if (spec.mode === "default") {
                const isOverridden = await this.overrideTracker.isOverridden(pluginId, key);
                if (!isOverridden) {
                    applied[key] = spec.value;
                }
            }
        }

        return { applied, enforced };
    }

    /**
     * Detect if a member's setting change constitutes a customization
     * relative to the team default. Records or clears the override.
     */
    async detectCustomization(
        entry: TeamSettingsEntry,
        settingKey: string,
        newValue: unknown,
    ): Promise<void> {
        const pluginId = entry._id.replace("team:settings:", "");
        const spec = entry.settings[settingKey];
        if (!spec || spec.mode !== "default") return;

        if (newValue === spec.value) {
            // Value matches team default — clear any existing override
            await this.overrideTracker.clearOverride(pluginId, settingKey);
        } else {
            // Value differs from team default — record override
            await this.overrideTracker.markOverridden(pluginId, settingKey);
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: All TeamSettingsApplier tests PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/TeamSettingsApplier.ts test/unit/team-phase5.test.ts
git commit -m "feat(team): add TeamSettingsApplier for enforced/default settings logic"
```

---

### Task 4: Events

Add settings governance events to the event hub.

**Files:**
- Modify: `src/modules/features/TeamSync/events.ts`

**Step 1: Add the event declarations**

Add to the `LSEvents` interface in `events.ts`:

```typescript
"team-settings-applied": { pluginId: string; enforced: string[] };
"team-settings-changed": { pluginId: string };
```

Add exported constants:

```typescript
export const EVENT_TEAM_SETTINGS_APPLIED = "team-settings-applied" as const;
export const EVENT_TEAM_SETTINGS_CHANGED = "team-settings-changed" as const;
```

The `TeamSettingsEntry` import already exists or add it.

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/events.ts
git commit -m "feat(team): add settings governance events"
```

---

### Task 5: CSS Styles

Add styles for the settings management admin UI and lockout indicators.

**Files:**
- Modify: `styles.css` (append)

**Step 1: Add the styles**

Append to `styles.css`:

```css
/* ── Phase 5: Team Settings Governance ─────────────────── */

/* Admin Settings Manager */
.team-settings-manager {
    padding: 12px 0;
}

.team-settings-manager-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.team-settings-manager-header h3 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
}

.team-settings-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.team-settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-radius: 4px;
    background: var(--background-secondary);
}

.team-settings-row:hover {
    background: var(--background-secondary-alt);
}

.team-settings-row-key {
    font-family: var(--font-monospace);
    font-size: 0.85em;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.team-settings-row-value {
    font-size: 0.8em;
    color: var(--text-muted);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 8px;
}

/* Three-state mode toggle */
.team-settings-mode-toggle {
    display: inline-flex;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
}

.team-settings-mode-toggle button {
    padding: 2px 8px;
    font-size: 0.75em;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}

.team-settings-mode-toggle button:not(:last-child) {
    border-right: 1px solid var(--background-modifier-border);
}

.team-settings-mode-toggle button.active-none {
    background: var(--background-primary);
    color: var(--text-normal);
}

.team-settings-mode-toggle button.active-default {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
}

.team-settings-mode-toggle button.active-enforced {
    background: var(--text-error);
    color: white;
}

/* Lockout indicator for enforced settings */
.team-setting-enforced {
    position: relative;
    opacity: 0.7;
    pointer-events: none;
}

.team-setting-enforced::after {
    content: "Managed by team admin";
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    font-size: 0.75em;
    color: var(--text-error);
    font-style: italic;
    pointer-events: none;
}

.team-setting-enforced .setting-item-control {
    opacity: 0.5;
}

/* Team settings notice banner */
.team-settings-notice {
    background: var(--background-secondary);
    border-left: 3px solid var(--interactive-accent);
    padding: 8px 12px;
    margin-bottom: 12px;
    border-radius: 0 4px 4px 0;
    font-size: 0.85em;
    color: var(--text-muted);
}

.team-settings-notice strong {
    color: var(--text-normal);
}

/* Settings search/filter in admin UI */
.team-settings-search {
    width: 100%;
    padding: 6px 10px;
    margin-bottom: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
}

.team-settings-search:focus {
    border-color: var(--interactive-accent);
    outline: none;
}

/* Category grouping */
.team-settings-category {
    margin-top: 8px;
}

.team-settings-category-header {
    font-size: 0.8em;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 10px;
}

/* Save button */
.team-settings-save {
    margin-top: 12px;
    display: flex;
    justify-content: flex-end;
}
```

**Step 2: Commit**

```bash
git add styles.css
git commit -m "feat(team): add CSS for settings governance UI and lockout indicators"
```

---

### Task 6: TeamSettingsManagerPane.svelte

Admin Svelte 5 component for managing which settings are pushed to the team. Mounted inside the Team Management section of the settings dialog.

**Files:**
- Create: `src/modules/features/TeamSync/TeamSettingsManagerPane.svelte`

**Design:**
- Shows a search box to filter settings
- Lists all settings from `ObsidianLiveSyncSettings` as rows
- Each row has: setting key, current value preview, three-state toggle (None / Default / Enforced)
- "Save" button persists changes to CouchDB as a `TeamSettingsEntry`
- Props: `getEntry()`, `getSettings()`, `onSave(entry)`, `settingKeys: string[]`

**Step 1: Write the component**

Create `src/modules/features/TeamSync/TeamSettingsManagerPane.svelte`:

```svelte
<script lang="ts">
    import type { TeamSettingsEntry } from "./types.ts";

    type Mode = "none" | "default" | "enforced";
    interface SettingRow {
        key: string;
        mode: Mode;
        value: unknown;
    }

    interface Props {
        settingKeys: string[];
        getEntry: () => Promise<TeamSettingsEntry | null>;
        getCurrentSettings: () => Record<string, unknown>;
        onSave: (entry: Omit<TeamSettingsEntry, "_id" | "_rev">) => Promise<void>;
    }

    let { settingKeys, getEntry, getCurrentSettings, onSave }: Props = $props();

    let rows: SettingRow[] = $state([]);
    let filter = $state("");
    let saving = $state(false);
    let dirty = $state(false);

    let filteredRows = $derived(
        filter
            ? rows.filter((r) => r.key.toLowerCase().includes(filter.toLowerCase()))
            : rows
    );

    let managedCount = $derived(rows.filter((r) => r.mode !== "none").length);

    async function load() {
        const currentSettings = getCurrentSettings();
        const entry = await getEntry();
        const managed = entry?.settings ?? {};

        rows = settingKeys.map((key) => ({
            key,
            mode: (managed[key]?.mode ?? "none") as Mode,
            value: currentSettings[key],
        }));
        dirty = false;
    }

    function setMode(key: string, mode: Mode) {
        const row = rows.find((r) => r.key === key);
        if (row) {
            row.mode = mode;
            rows = [...rows]; // trigger reactivity
            dirty = true;
        }
    }

    async function save() {
        saving = true;
        try {
            const currentSettings = getCurrentSettings();
            const settings: Record<string, { value: unknown; mode: "default" | "enforced" }> = {};
            for (const row of rows) {
                if (row.mode !== "none") {
                    settings[row.key] = {
                        value: currentSettings[row.key],
                        mode: row.mode as "default" | "enforced",
                    };
                }
            }
            await onSave({
                managedBy: "",  // filled by caller
                updatedAt: new Date().toISOString(),
                settings,
            });
            dirty = false;
        } finally {
            saving = false;
        }
    }

    function formatValue(val: unknown): string {
        if (val === undefined || val === null) return "—";
        if (typeof val === "boolean") return val ? "true" : "false";
        if (typeof val === "string") return val.length > 20 ? val.slice(0, 20) + "…" : val;
        if (typeof val === "number") return String(val);
        return typeof val;
    }

    // Load on mount
    load();
</script>

<div class="team-settings-manager">
    <div class="team-settings-manager-header">
        <h3>Managed Settings ({managedCount})</h3>
    </div>

    <input
        class="team-settings-search"
        type="text"
        placeholder="Filter settings…"
        bind:value={filter}
    />

    <div class="team-settings-list">
        {#each filteredRows as row (row.key)}
            <div class="team-settings-row">
                <span class="team-settings-row-key" title={row.key}>{row.key}</span>
                <span class="team-settings-row-value" title={String(row.value ?? "")}>
                    {formatValue(row.value)}
                </span>
                <div class="team-settings-mode-toggle">
                    <button
                        class:active-none={row.mode === "none"}
                        onclick={() => setMode(row.key, "none")}
                        title="Not managed — members keep their own value"
                    >—</button>
                    <button
                        class:active-default={row.mode === "default"}
                        onclick={() => setMode(row.key, "default")}
                        title="Default — pushed unless member customized"
                    >D</button>
                    <button
                        class:active-enforced={row.mode === "enforced"}
                        onclick={() => setMode(row.key, "enforced")}
                        title="Enforced — always overrides local value"
                    >E</button>
                </div>
            </div>
        {/each}
    </div>

    {#if dirty}
        <div class="team-settings-save">
            <button class="mod-cta" onclick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Team Settings"}
            </button>
        </div>
    {/if}
</div>
```

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/TeamSettingsManagerPane.svelte
git commit -m "feat(team): add admin TeamSettingsManagerPane component"
```

---

### Task 7: Wire into ModuleTeamSync

Connect all Phase 5 components into the module lifecycle. This is the largest task.

**Files:**
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts`

**What to add:**

1. **New imports** at top of file:

```typescript
import { TeamSettingsStore } from "./TeamSettingsStore.ts";
import { TeamOverrideTracker } from "./TeamOverrideTracker.ts";
import { TeamSettingsApplier } from "./TeamSettingsApplier.ts";
import { EVENT_TEAM_SETTINGS_APPLIED, EVENT_TEAM_SETTINGS_CHANGED } from "./events.ts";
import { EVENT_SETTING_SAVED } from "../../../lib/src/events/coreEvents.ts";
```

2. **New fields** in the module class:

```typescript
settingsStore!: TeamSettingsStore;
overrideTracker!: TeamOverrideTracker;
settingsApplier!: TeamSettingsApplier;
_enforcedSettings = new Map<string, Set<string>>(); // pluginId → Set<settingKey>
```

3. **In `_onReady()`** — initialize the new stores:

```typescript
this.settingsStore = new TeamSettingsStore(this.localDatabase);
const overrideStore = this.services.database.openSimpleStore<any>("team-overrides");
this.overrideTracker = new TeamOverrideTracker(overrideStore);
this.settingsApplier = new TeamSettingsApplier(this.overrideTracker);
```

4. **In `_onDocumentArrived()`** — detect `team:settings:*` documents and apply:

```typescript
if (docId.startsWith("team:settings:")) {
    const pluginId = docId.replace("team:settings:", "");
    this._applyTeamSettings(pluginId);
    this.services.event.emitEvent(EVENT_TEAM_SETTINGS_CHANGED, { pluginId });
}
```

5. **New method `_applyTeamSettings(pluginId: string)`**:

```typescript
async _applyTeamSettings(pluginId: string): Promise<void> {
    if (!this._teamConfig?.features.settingsPush) return;
    if (this._isAdmin()) return; // Admins are not affected by pushed settings

    const entry = await this.settingsStore.getEntry(pluginId);
    if (!entry) return;

    // For now, only handle self-hosted-livesync settings
    if (pluginId === "self-hosted-livesync") {
        const currentSettings = { ...this.settings } as Record<string, unknown>;
        const result = await this.settingsApplier.apply(entry, currentSettings);

        // Apply changed settings
        let changed = false;
        for (const [key, value] of Object.entries(result.applied)) {
            if ((this.settings as any)[key] !== value) {
                (this.settings as any)[key] = value;
                changed = true;
            }
        }

        // Update enforced set
        this._enforcedSettings.set(pluginId, new Set(result.enforced));

        if (changed) {
            await this.plugin.saveSettings();
        }

        this.services.event.emitEvent(EVENT_TEAM_SETTINGS_APPLIED, {
            pluginId,
            enforced: result.enforced,
        });
    }
}
```

6. **Apply on initial load** — in `_everyOnloadStart()` or after config is loaded:

```typescript
// After team config is loaded, apply all team settings
if (this._teamConfig?.features.settingsPush) {
    const entries = await this.settingsStore.getAllEntries();
    for (const entry of entries) {
        const pluginId = entry._id.replace("team:settings:", "");
        await this._applyTeamSettings(pluginId);
    }
}
```

7. **Detect member customization** — listen to `EVENT_SETTING_SAVED`:

```typescript
this.services.event.onEvent(EVENT_SETTING_SAVED, async (settings: any) => {
    if (!this._teamConfig?.features.settingsPush) return;
    if (this._isAdmin()) return;

    const entry = await this.settingsStore.getEntry("self-hosted-livesync");
    if (!entry) return;

    for (const key of Object.keys(entry.settings)) {
        if (entry.settings[key].mode === "default") {
            await this.settingsApplier.detectCustomization(entry, key, (settings as any)[key]);
        }
    }
});
```

8. **Admin UI mount point** — in the team management settings section, add a container for the admin settings manager:

```typescript
if (this._isAdmin() && this._teamConfig?.features.settingsPush) {
    const container = containerEl.createDiv();
    const settingKeys = Object.keys(this.settings).filter(
        (k) => !k.startsWith("_") && k !== "configPassphrase"
    );
    mount(TeamSettingsManagerPane, {
        target: container,
        props: {
            settingKeys,
            getEntry: () => this.settingsStore.getEntry("self-hosted-livesync"),
            getCurrentSettings: () => ({ ...this.settings } as Record<string, unknown>),
            onSave: async (partial) => {
                const entry = {
                    _id: "team:settings:self-hosted-livesync" as `team:settings:${string}`,
                    ...partial,
                    managedBy: this.getCurrentUsername(),
                };
                await this.settingsStore.saveEntry(entry as any);
            },
        },
    });
}
```

9. **Settings lockout** — add enforced notice banner when non-admin loads settings:

```typescript
_addEnforcedSettingsNotice(containerEl: HTMLElement): void {
    const enforcedKeys = this._enforcedSettings.get("self-hosted-livesync");
    if (!enforcedKeys?.size) return;

    const notice = containerEl.createDiv({ cls: "team-settings-notice" });
    notice.innerHTML = `<strong>Team-managed settings:</strong> ${enforcedKeys.size} setting(s) are managed by your team admin and cannot be changed.`;
}
```

10. **Helper `_isAdmin()`**:

```typescript
private _isAdmin(): boolean {
    if (!this._teamConfig) return false;
    const username = this.getCurrentUsername();
    return this._teamConfig.members[username]?.role === "admin";
}
```

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): wire settings governance into ModuleTeamSync"
```

---

### Task 8: Integration Tests

End-to-end tests verifying the Phase 5 components work together.

**Files:**
- Modify: `test/unit/team-phase5.test.ts`

**Step 1: Add integration tests**

Append to `test/unit/team-phase5.test.ts`:

```typescript
describe("Phase 5 Integration", () => {
    it("should export TeamSettingsStore with all methods", async () => {
        const { TeamSettingsStore } = await import(
            "../../src/modules/features/TeamSync/TeamSettingsStore"
        );
        const methods = ["getEntry", "getAllEntries", "saveEntry", "removeSetting"];
        for (const m of methods) {
            expect(typeof TeamSettingsStore.prototype[m]).toBe("function");
        }
    });

    it("should export TeamOverrideTracker with all methods", async () => {
        const { TeamOverrideTracker } = await import(
            "../../src/modules/features/TeamSync/TeamOverrideTracker"
        );
        const methods = ["isOverridden", "markOverridden", "clearOverride", "getOverrides", "clearAllOverrides"];
        for (const m of methods) {
            expect(typeof TeamOverrideTracker.prototype[m]).toBe("function");
        }
    });

    it("should export TeamSettingsApplier with all methods", async () => {
        const { TeamSettingsApplier } = await import(
            "../../src/modules/features/TeamSync/TeamSettingsApplier"
        );
        const methods = ["apply", "detectCustomization"];
        for (const m of methods) {
            expect(typeof TeamSettingsApplier.prototype[m]).toBe("function");
        }
    });

    it("should export settings governance events", async () => {
        const { EVENT_TEAM_SETTINGS_APPLIED, EVENT_TEAM_SETTINGS_CHANGED } = await import(
            "../../src/modules/features/TeamSync/events"
        );
        expect(EVENT_TEAM_SETTINGS_APPLIED).toBe("team-settings-applied");
        expect(EVENT_TEAM_SETTINGS_CHANGED).toBe("team-settings-changed");
    });

    it("should apply settings end-to-end: store → apply → override → re-apply", async () => {
        const { TeamSettingsStore } = await import(
            "../../src/modules/features/TeamSync/TeamSettingsStore"
        );
        const { TeamOverrideTracker } = await import(
            "../../src/modules/features/TeamSync/TeamOverrideTracker"
        );
        const { TeamSettingsApplier } = await import(
            "../../src/modules/features/TeamSync/TeamSettingsApplier"
        );

        // Setup mock DB and SimpleStore
        const mockDB = createMockDB();
        const settingsStore = new TeamSettingsStore({ localDatabase: mockDB } as any);

        const overrideData = new Map<string, any>();
        const mockOverrideStore = {
            get: async (key: string) => overrideData.get(key),
            set: async (key: string, value: any) => { overrideData.set(key, value); },
            delete: async (key: string) => { overrideData.delete(key); },
        };
        const overrideTracker = new TeamOverrideTracker(mockOverrideStore as any);
        const applier = new TeamSettingsApplier(overrideTracker);

        // Admin saves team settings
        await settingsStore.saveEntry({
            _id: "team:settings:self-hosted-livesync" as `team:settings:${string}`,
            managedBy: "alice",
            updatedAt: new Date().toISOString(),
            settings: {
                liveSync: { value: true, mode: "enforced" },
                syncOnStart: { value: true, mode: "default" },
                batchSave: { value: false, mode: "default" },
            },
        });

        // Member's current settings
        const memberSettings = { liveSync: false, syncOnStart: false, batchSave: true, deviceName: "laptop" };

        // First apply — enforced and defaults applied
        const entry = await settingsStore.getEntry("self-hosted-livesync");
        const result1 = await applier.apply(entry!, memberSettings);
        expect(result1.applied.liveSync).toBe(true);       // enforced
        expect(result1.applied.syncOnStart).toBe(true);     // default applied
        expect(result1.applied.batchSave).toBe(false);      // default applied
        expect(result1.applied.deviceName).toBe("laptop");  // untouched

        // Member customizes syncOnStart
        await applier.detectCustomization(entry!, "syncOnStart", false);
        expect(await overrideTracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(true);

        // Re-apply — member's override preserved for syncOnStart
        const result2 = await applier.apply(entry!, { ...memberSettings, syncOnStart: false });
        expect(result2.applied.syncOnStart).toBe(false);    // member's value preserved
        expect(result2.applied.liveSync).toBe(true);         // still enforced
        expect(result2.applied.batchSave).toBe(false);       // still default (not overridden)
    });
});
```

**Step 2: Run all tests**

Run: `npx vitest run test/unit/team-phase5.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add test/unit/team-phase5.test.ts
git commit -m "test(team): add Phase 5 integration tests"
```

---

## Summary

| Task | Description | New Files | Tests |
|------|-------------|-----------|-------|
| 1 | TeamSettingsStore | `TeamSettingsStore.ts` | 5 |
| 2 | TeamOverrideTracker | `TeamOverrideTracker.ts` | 6 |
| 3 | TeamSettingsApplier | `TeamSettingsApplier.ts` | 8 |
| 4 | Events | — (modify `events.ts`) | — |
| 5 | CSS Styles | — (modify `styles.css`) | — |
| 6 | Admin UI | `TeamSettingsManagerPane.svelte` | — |
| 7 | Wire into Module | — (modify `ModuleTeamSync.ts`) | — |
| 8 | Integration Tests | — | 5 |

**Total: 3 new TS files + 1 new Svelte component + 24 tests**
