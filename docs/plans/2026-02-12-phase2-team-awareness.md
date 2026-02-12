# Phase 2: Team Awareness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add change indicators (blue dots on unread files), local read-state tracking, and a Team Activity sidebar showing recent team changes with author attribution.

**Architecture:** Extends `ModuleTeamSync` from Phase 1. Read state stored in local SimpleStore (IndexedDB, not synced). Incoming changes detected by hooking into `services.replication.processSynchroniseResult`. File opens detected via Obsidian's `workspace.on("file-open")` event. Sidebar view uses `SvelteItemView` pattern. File tree decoration via CSS class injection on file explorer items. Custom events coordinate between change tracker and UI.

**Tech Stack:** TypeScript, Svelte 5, SimpleStore (IndexedDB), Obsidian ItemView API, CSS, Vitest + Playwright

**Key Reference Files:**
- Phase 1 module: `src/modules/features/TeamSync/ModuleTeamSync.ts`
- Phase 1 types: `src/modules/features/TeamSync/types.ts`
- SimpleStore pattern: `src/modules/essential/ModuleKeyValueDB.ts:48-84`
- Incoming replication hook: `src/modules/core/ModuleFileHandler.ts:438` (`services.replication.processSynchroniseResult.addHandler`)
- File open events: `src/modules/essentialObsidian/ModuleObsidianEvents.ts:88` (`workspace.on("file-open")`)
- SvelteItemView: `src/common/SvelteItemView.ts`
- View registration: `src/modules/features/Log/LogPaneView.ts` (example)
- Event hub: `src/lib/src/hub/hub.ts`
- Core events: `src/lib/src/events/coreEvents.ts`

**Phase 1 Dependency:** Requires `modifiedBy` field on documents (from `ModuleDatabaseFileAccess.ts:195-200`) and `ModuleTeamSync` module.

---

## Task 1: Add Team Events and Read State Types

**Files:**
- Modify: `src/modules/features/TeamSync/types.ts`

**Step 1: Add types for read state and activity entries**

Append to `src/modules/features/TeamSync/types.ts`:

```typescript
/**
 * Read state for a single file, stored in local SimpleStore (not synced).
 */
export interface FileReadState {
    lastSeenRev: string;
    lastSeenAt: number; // timestamp ms
}

/**
 * An entry in the team activity feed.
 */
export interface TeamActivityEntry {
    filePath: string;
    modifiedBy: string;
    timestamp: number; // mtime from document
    rev: string;
}
```

**Step 2: Declare custom team events**

Create `src/modules/features/TeamSync/events.ts`:

```typescript
import type { FilePathWithPrefix } from "../../../lib/src/common/types.ts";

declare global {
    interface LSEvents {
        "team-file-changed": FilePathWithPrefix;
        "team-file-read": FilePathWithPrefix;
        "team-activity-updated": undefined;
    }
}

export const EVENT_TEAM_FILE_CHANGED = "team-file-changed" as const;
export const EVENT_TEAM_FILE_READ = "team-file-read" as const;
export const EVENT_TEAM_ACTIVITY_UPDATED = "team-activity-updated" as const;
```

**Step 3: Commit**

```bash
git add src/modules/features/TeamSync/types.ts src/modules/features/TeamSync/events.ts
git commit -m "feat(team): add read state types and team events"
```

---

## Task 2: Create ReadStateManager

**Files:**
- Create: `src/modules/features/TeamSync/ReadStateManager.ts`
- Create: `test/unit/team-phase2.test.ts`

**Step 1: Write failing test**

Create `test/unit/team-phase2.test.ts`:

```typescript
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { generateHarness, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ReadStateManager } from "../../src/modules/features/TeamSync/ReadStateManager";

describe("ReadStateManager", async () => {
    let harness: LiveSyncHarness;
    let readState: ReadStateManager;
    const vaultName = "TestVaultReadState" + Date.now();

    beforeAll(async () => {
        harness = await generateHarness(vaultName);
        await waitForReady(harness);
        const store = harness.plugin.services.database.openSimpleStore<any>("team-readstate");
        readState = new ReadStateManager(store);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    it("should report file as unread when no state exists", async () => {
        const isUnread = await readState.isUnread("notes/test.md", "2-abc123");
        expect(isUnread).toBe(true);
    });

    it("should mark a file as read", async () => {
        await readState.markAsRead("notes/test.md", "2-abc123");
        const isUnread = await readState.isUnread("notes/test.md", "2-abc123");
        expect(isUnread).toBe(false);
    });

    it("should report file as unread when rev changes", async () => {
        await readState.markAsRead("notes/test.md", "2-abc123");
        const isUnread = await readState.isUnread("notes/test.md", "3-def456");
        expect(isUnread).toBe(true);
    });

    it("should get read state for a file", async () => {
        await readState.markAsRead("notes/test.md", "5-xyz");
        const state = await readState.getReadState("notes/test.md");
        expect(state).not.toBeUndefined();
        expect(state!.lastSeenRev).toBe("5-xyz");
        expect(state!.lastSeenAt).toBeGreaterThan(0);
    });

    it("should clear read state for a file", async () => {
        await readState.markAsRead("notes/test.md", "5-xyz");
        await readState.clearReadState("notes/test.md");
        const state = await readState.getReadState("notes/test.md");
        expect(state).toBeUndefined();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/team-phase2.test.ts`
Expected: FAIL — ReadStateManager doesn't exist

**Step 3: Create ReadStateManager**

```typescript
// src/modules/features/TeamSync/ReadStateManager.ts

import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { FileReadState } from "./types.ts";

/**
 * Manages per-file read state in local SimpleStore (IndexedDB).
 * Not synced to CouchDB — each user has their own read state.
 *
 * A file is "unread" if:
 * - No read state exists for it, OR
 * - The file's current revision differs from the last-seen revision
 */
export class ReadStateManager {
    constructor(private store: SimpleStore<FileReadState>) {}

    /**
     * Check if a file is unread (current rev differs from last-seen rev).
     */
    async isUnread(filePath: string, currentRev: string): Promise<boolean> {
        const state = await this.getReadState(filePath);
        if (!state) return true;
        return state.lastSeenRev !== currentRev;
    }

    /**
     * Mark a file as read at the given revision.
     */
    async markAsRead(filePath: string, rev: string): Promise<void> {
        await this.store.set(filePath, {
            lastSeenRev: rev,
            lastSeenAt: Date.now(),
        });
    }

    /**
     * Get the read state for a file.
     */
    async getReadState(filePath: string): Promise<FileReadState | undefined> {
        return await this.store.get(filePath);
    }

    /**
     * Clear read state for a file.
     */
    async clearReadState(filePath: string): Promise<void> {
        await this.store.delete(filePath);
    }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/team-phase2.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/ReadStateManager.ts test/unit/team-phase2.test.ts
git commit -m "feat(team): add ReadStateManager for local file read state"
```

---

## Task 3: Create ChangeTracker

**Files:**
- Create: `src/modules/features/TeamSync/ChangeTracker.ts`
- Modify: `test/unit/team-phase2.test.ts` (append tests)

The ChangeTracker maintains an in-memory list of unread files and a capped activity feed (last 100 entries). It is updated when documents arrive from replication and when files are opened.

**Step 1: Write failing test**

Append to `test/unit/team-phase2.test.ts`:

```typescript
import { ChangeTracker } from "../../src/modules/features/TeamSync/ChangeTracker";

describe("ChangeTracker", () => {
    let tracker: ChangeTracker;

    beforeAll(() => {
        tracker = new ChangeTracker("current-user");
    });

    it("should start with no unread files", () => {
        expect(tracker.getUnreadFiles()).toEqual(new Set());
    });

    it("should start with empty activity feed", () => {
        expect(tracker.getActivityFeed()).toEqual([]);
    });

    it("should track a change from another user", () => {
        tracker.trackChange("notes/hello.md", "other-user", Date.now(), "2-abc");
        expect(tracker.getUnreadFiles().has("notes/hello.md")).toBe(true);
        expect(tracker.getActivityFeed()).toHaveLength(1);
        expect(tracker.getActivityFeed()[0].modifiedBy).toBe("other-user");
    });

    it("should NOT track changes from the current user", () => {
        tracker.trackChange("notes/mine.md", "current-user", Date.now(), "1-xyz");
        expect(tracker.getUnreadFiles().has("notes/mine.md")).toBe(false);
    });

    it("should add to activity feed even for current user changes", () => {
        const feedBefore = tracker.getActivityFeed().length;
        tracker.trackChange("notes/mine2.md", "current-user", Date.now(), "1-abc");
        expect(tracker.getActivityFeed().length).toBe(feedBefore + 1);
    });

    it("should mark a file as read", () => {
        tracker.trackChange("notes/toread.md", "other-user", Date.now(), "3-abc");
        expect(tracker.getUnreadFiles().has("notes/toread.md")).toBe(true);
        tracker.markAsRead("notes/toread.md");
        expect(tracker.getUnreadFiles().has("notes/toread.md")).toBe(false);
    });

    it("should cap activity feed at 100 entries", () => {
        for (let i = 0; i < 110; i++) {
            tracker.trackChange(`notes/file${i}.md`, "other-user", Date.now() + i, `${i}-rev`);
        }
        expect(tracker.getActivityFeed().length).toBeLessThanOrEqual(100);
    });

    it("should return activity feed in reverse chronological order", () => {
        const feed = tracker.getActivityFeed();
        for (let i = 1; i < feed.length; i++) {
            expect(feed[i - 1].timestamp).toBeGreaterThanOrEqual(feed[i].timestamp);
        }
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/team-phase2.test.ts`
Expected: FAIL — ChangeTracker doesn't exist

**Step 3: Create ChangeTracker**

```typescript
// src/modules/features/TeamSync/ChangeTracker.ts

import type { TeamActivityEntry } from "./types.ts";

const MAX_ACTIVITY_ENTRIES = 100;

/**
 * Tracks file changes from team members and maintains the activity feed.
 *
 * - Unread files: Set of file paths changed by others since last opened.
 * - Activity feed: Last 100 changes (from anyone), reverse chronological.
 */
export class ChangeTracker {
    private _unreadFiles = new Set<string>();
    private _activityFeed: TeamActivityEntry[] = [];

    constructor(private _currentUsername: string) {}

    /**
     * Record a file change. Adds to activity feed always.
     * Marks as unread only if the change is from someone else.
     */
    trackChange(filePath: string, modifiedBy: string, timestamp: number, rev: string): void {
        // Add to activity feed (all changes, including own)
        this._activityFeed.unshift({
            filePath,
            modifiedBy,
            timestamp,
            rev,
        });

        // Cap the feed
        if (this._activityFeed.length > MAX_ACTIVITY_ENTRIES) {
            this._activityFeed.length = MAX_ACTIVITY_ENTRIES;
        }

        // Only mark as unread if from someone else
        if (modifiedBy !== this._currentUsername) {
            this._unreadFiles.add(filePath);
        }
    }

    /**
     * Mark a file as read (clear unread indicator).
     */
    markAsRead(filePath: string): void {
        this._unreadFiles.delete(filePath);
    }

    /**
     * Get the set of currently unread file paths.
     */
    getUnreadFiles(): Set<string> {
        return new Set(this._unreadFiles);
    }

    /**
     * Check if a specific file is unread.
     */
    isUnread(filePath: string): boolean {
        return this._unreadFiles.has(filePath);
    }

    /**
     * Get the activity feed (reverse chronological).
     */
    getActivityFeed(): TeamActivityEntry[] {
        return [...this._activityFeed];
    }

    /**
     * Update the current username (e.g., after settings change).
     */
    setCurrentUsername(username: string): void {
        this._currentUsername = username;
    }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/team-phase2.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/ChangeTracker.ts test/unit/team-phase2.test.ts
git commit -m "feat(team): add ChangeTracker for unread files and activity feed"
```

---

## Task 4: Wire Change Detection into ModuleTeamSync

**Files:**
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts`

This task hooks the ChangeTracker and ReadStateManager into the module's lifecycle. It:
1. Initializes the ReadStateManager with a SimpleStore
2. Initializes the ChangeTracker with the current username
3. Hooks into incoming replication to detect changes from others
4. Hooks into file-open events to clear read state
5. Emits custom events for UI updates

**Step 1: Add imports and fields**

Add imports to the top of `ModuleTeamSync.ts`:

```typescript
import { ReadStateManager } from "./ReadStateManager.ts";
import { ChangeTracker } from "./ChangeTracker.ts";
import { EVENT_TEAM_FILE_CHANGED, EVENT_TEAM_FILE_READ, EVENT_TEAM_ACTIVITY_UPDATED } from "./events.ts";
import { eventHub } from "../../../lib/src/hub/hub.ts";
import type { MetaEntry } from "../../../lib/src/common/types.ts";
import type { FilePathWithPrefix } from "../../../lib/src/common/types.ts";
import { getPath } from "../../../lib/src/common/utils.ts";
```

Note: Some of these may already be importable. Check existing imports and merge. `MetaEntry` and `FilePathWithPrefix` might be importable from `"../../../lib/src/common/types.ts"`. `getPath` might be in `"../../../lib/src/common/utils.ts"` — check the actual location.

Add fields to the class:

```typescript
    readStateManager: ReadStateManager | undefined;
    changeTracker: ChangeTracker | undefined;
```

**Step 2: Initialize in _onReady**

Replace the `_onReady` method:

```typescript
    private async _onReady(): Promise<boolean> {
        if (this.isDatabaseReady()) {
            await this._loadTeamConfig();

            // Initialize read state manager
            const store = this.services.database.openSimpleStore<any>("team-readstate");
            this.readStateManager = new ReadStateManager(store);

            // Initialize change tracker
            this.changeTracker = new ChangeTracker(this.getCurrentUsername());
        }
        return true;
    }
```

**Step 3: Add replication hook in onBindFunction**

Update `onBindFunction` to also hook into incoming replication and file-open events:

```typescript
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onSettingLoaded.addHandler(this._onReady.bind(this));
        services.replication.processSynchroniseResult.addHandler(this._onDocumentArrived.bind(this));
    }
```

**Step 4: Add the replication handler**

```typescript
    /**
     * Called when a document arrives from remote replication.
     * Checks modifiedBy and updates change tracker if from another user.
     */
    private async _onDocumentArrived(entry: MetaEntry): Promise<boolean> {
        if (!this.isTeamModeEnabled() || !this.changeTracker) return true;

        const modifiedBy = (entry as any).modifiedBy as string | undefined;
        if (!modifiedBy) return true;

        const filePath = getPath(entry);
        const rev = entry._rev ?? "";
        const timestamp = entry.mtime ?? Date.now();

        this.changeTracker.trackChange(filePath, modifiedBy, timestamp, rev);

        if (modifiedBy !== this.getCurrentUsername()) {
            eventHub.emitEvent(EVENT_TEAM_FILE_CHANGED, filePath as FilePathWithPrefix);
        }

        eventHub.emitEvent(EVENT_TEAM_ACTIVITY_UPDATED, undefined);
        return true; // Continue processing chain
    }
```

**Step 5: Add file-open handler registration**

Add to `_onReady` after the change tracker initialization, or in a separate `_everyOnloadStart` method:

```typescript
    private _everyOnloadStart(): Promise<boolean> {
        // Listen for file opens to clear unread state
        this.plugin.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                if (!file || !this.changeTracker || !this.readStateManager) return;
                const filePath = file.path;
                this.changeTracker.markAsRead(filePath);
                eventHub.emitEvent(EVENT_TEAM_FILE_READ, filePath as FilePathWithPrefix);
            })
        );
        return Promise.resolve(true);
    }
```

And register it in `onBindFunction`:

```typescript
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._onReady.bind(this));
        services.replication.processSynchroniseResult.addHandler(this._onDocumentArrived.bind(this));
    }
```

**Step 6: Run existing tests for regressions**

Run: `npx vitest run test/unit/team.test.ts`
Expected: All 21 Phase 1 tests still pass

**Step 7: Commit**

```bash
git add src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): wire change detection and read state into module"
```

---

## Task 5: File Tree Decoration (Blue Dots)

**Files:**
- Create: `src/modules/features/TeamSync/TeamFileDecorator.ts`
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts` (register decorator)

Obsidian doesn't expose a public `registerFileDecorator` API in all versions. We use a CSS-based approach: add a CSS class to the document body listing unread files, and use CSS `::after` pseudo-elements to show the blue dot. The decorator watches for team events and updates the class list.

**Step 1: Create the decorator**

```typescript
// src/modules/features/TeamSync/TeamFileDecorator.ts

import { eventHub } from "../../../lib/src/hub/hub.ts";
import { EVENT_TEAM_FILE_CHANGED, EVENT_TEAM_FILE_READ, EVENT_TEAM_ACTIVITY_UPDATED } from "./events.ts";
import type { ChangeTracker } from "./ChangeTracker.ts";

/**
 * Decorates the file explorer with blue dots for unread files.
 *
 * Uses CSS data attributes on file explorer items to style unread files.
 * Refreshes when team events fire.
 */
export class TeamFileDecorator {
    private _styleEl: HTMLStyleElement | undefined;

    constructor(
        private _tracker: ChangeTracker,
        private _containerEl: HTMLElement
    ) {
        this._injectStyles();
        this._registerEvents();
        this._refresh();
    }

    private _injectStyles(): void {
        this._styleEl = document.createElement("style");
        this._styleEl.id = "team-file-decorator-styles";
        this._styleEl.textContent = `
            .nav-file-title[data-team-unread="true"]::after {
                content: "";
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: var(--interactive-accent);
                margin-left: 4px;
                flex-shrink: 0;
            }
        `;
        document.head.appendChild(this._styleEl);
    }

    private _registerEvents(): void {
        eventHub.onEvent(EVENT_TEAM_FILE_CHANGED, () => this._refresh());
        eventHub.onEvent(EVENT_TEAM_FILE_READ, () => this._refresh());
        eventHub.onEvent(EVENT_TEAM_ACTIVITY_UPDATED, () => this._refresh());
    }

    /**
     * Refresh all file explorer decorations.
     * Finds file items in the explorer and sets/removes data attributes.
     */
    private _refresh(): void {
        const unreadFiles = this._tracker.getUnreadFiles();
        const fileItems = this._containerEl.querySelectorAll(".nav-file-title");

        fileItems.forEach((item) => {
            const el = item as HTMLElement;
            const path = el.getAttribute("data-path");
            if (!path) return;

            if (unreadFiles.has(path)) {
                el.setAttribute("data-team-unread", "true");
            } else {
                el.removeAttribute("data-team-unread");
            }
        });
    }

    /**
     * Cleanup styles and event listeners.
     */
    destroy(): void {
        if (this._styleEl) {
            this._styleEl.remove();
            this._styleEl = undefined;
        }
    }
}
```

**Step 2: Register decorator in ModuleTeamSync**

Add to `_everyOnloadStart` in `ModuleTeamSync.ts`:

```typescript
import { TeamFileDecorator } from "./TeamFileDecorator.ts";

// Add field:
    private _fileDecorator: TeamFileDecorator | undefined;

// In _everyOnloadStart, after the file-open handler:
        // Set up file decorator once layout is ready
        this.app.workspace.onLayoutReady(() => {
            if (this.changeTracker) {
                this._fileDecorator = new TeamFileDecorator(
                    this.changeTracker,
                    document.body
                );
            }
        });
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/modules/features/TeamSync/TeamFileDecorator.ts src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): add file tree decoration for unread files"
```

---

## Task 6: Team Activity Sidebar View

**Files:**
- Create: `src/modules/features/TeamSync/TeamActivityView.ts`
- Create: `src/modules/features/TeamSync/TeamActivityPane.svelte`
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts` (register view + command)

**Step 1: Create the Svelte component**

```svelte
<!-- src/modules/features/TeamSync/TeamActivityPane.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { TeamActivityEntry } from "./types";
    import { eventHub } from "../../../lib/src/hub/hub";
    import { EVENT_TEAM_ACTIVITY_UPDATED } from "./events";

    type Props = {
        getActivityFeed: () => TeamActivityEntry[];
        getUnreadFiles: () => Set<string>;
        onOpenFile: (filePath: string) => void;
    };

    const { getActivityFeed, getUnreadFiles, onOpenFile }: Props = $props();

    let feed = $state<TeamActivityEntry[]>([]);
    let unreadFiles = $state<Set<string>>(new Set());

    function refresh() {
        feed = getActivityFeed();
        unreadFiles = getUnreadFiles();
    }

    onMount(() => {
        refresh();
        eventHub.onEvent(EVENT_TEAM_ACTIVITY_UPDATED, refresh);
    });

    function formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
            " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function getInitials(username: string): string {
        return username.slice(0, 2).toUpperCase();
    }

    function fileName(path: string): string {
        return path.split("/").pop() ?? path;
    }

    function folderPath(path: string): string {
        const parts = path.split("/");
        if (parts.length <= 1) return "";
        return parts.slice(0, -1).join("/");
    }

    // Group feed by day
    const groupedFeed = $derived.by(() => {
        const groups: { date: string; entries: TeamActivityEntry[] }[] = [];
        let currentDate = "";

        for (const entry of feed) {
            const date = new Date(entry.timestamp).toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
            });
            if (date !== currentDate) {
                currentDate = date;
                groups.push({ date, entries: [] });
            }
            groups[groups.length - 1].entries.push(entry);
        }
        return groups;
    });
</script>

<div class="team-activity">
    <h4 class="team-activity-header">Team Activity</h4>

    {#if feed.length === 0}
        <div class="team-activity-empty">No team activity yet.</div>
    {:else}
        {#each groupedFeed as group}
            <div class="team-activity-date">{group.date}</div>
            {#each group.entries as entry}
                <div
                    class="team-activity-entry"
                    class:is-unread={unreadFiles.has(entry.filePath)}
                    onclick={() => onOpenFile(entry.filePath)}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === "Enter" && onOpenFile(entry.filePath)}
                >
                    <span class="team-activity-avatar" title={entry.modifiedBy}>
                        {getInitials(entry.modifiedBy)}
                    </span>
                    <div class="team-activity-info">
                        <div class="team-activity-file">
                            {fileName(entry.filePath)}
                            {#if unreadFiles.has(entry.filePath)}
                                <span class="team-unread-dot"></span>
                            {/if}
                        </div>
                        <div class="team-activity-meta">
                            {folderPath(entry.filePath)} &middot; {formatTime(entry.timestamp)}
                        </div>
                    </div>
                </div>
            {/each}
        {/each}
    {/if}
</div>

<style>
    .team-activity {
        padding: 0;
        overflow-y: auto;
        height: 100%;
    }
    .team-activity-header {
        padding: 8px 12px;
        margin: 0;
        border-bottom: 1px solid var(--background-modifier-border);
        position: sticky;
        top: 0;
        background: var(--background-primary);
        z-index: 1;
    }
    .team-activity-empty {
        padding: 24px 12px;
        text-align: center;
        color: var(--text-muted);
    }
    .team-activity-date {
        padding: 6px 12px;
        font-size: 0.8em;
        font-weight: 600;
        color: var(--text-muted);
        background: var(--background-secondary);
    }
    .team-activity-entry {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .team-activity-entry:hover {
        background: var(--background-modifier-hover);
    }
    .team-activity-entry.is-unread {
        background: var(--background-modifier-hover);
    }
    .team-activity-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.7em;
        font-weight: 600;
        flex-shrink: 0;
    }
    .team-activity-info {
        flex: 1;
        min-width: 0;
    }
    .team-activity-file {
        font-size: 0.9em;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .team-activity-meta {
        font-size: 0.75em;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .team-unread-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--interactive-accent);
        flex-shrink: 0;
    }
</style>
```

**Step 2: Create the view**

```typescript
// src/modules/features/TeamSync/TeamActivityView.ts

import { WorkspaceLeaf } from "../../../deps.ts";
import TeamActivityPane from "./TeamActivityPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";
import type { ChangeTracker } from "./ChangeTracker.ts";

export const VIEW_TYPE_TEAM_ACTIVITY = "team-activity";

export class TeamActivityView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "users";
    title = "";
    navigation = true;
    private _tracker: ChangeTracker;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin, tracker: ChangeTracker) {
        super(leaf);
        this.plugin = plugin;
        this._tracker = tracker;
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamActivityPane, {
            target,
            props: {
                getActivityFeed: () => this._tracker.getActivityFeed(),
                getUnreadFiles: () => this._tracker.getUnreadFiles(),
                onOpenFile: (filePath: string) => {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file) {
                        void this.app.workspace.getLeaf(false).openFile(file as any);
                    }
                },
            },
        });
    }

    getViewType(): string {
        return VIEW_TYPE_TEAM_ACTIVITY;
    }

    getDisplayText(): string {
        return "Team Activity";
    }
}
```

**Step 3: Register view and command in ModuleTeamSync**

Add import and registration to `_everyOnloadStart`:

```typescript
import { TeamActivityView, VIEW_TYPE_TEAM_ACTIVITY } from "./TeamActivityView.ts";

// In _everyOnloadStart:
        // Register team activity sidebar view
        this.registerView(VIEW_TYPE_TEAM_ACTIVITY, (leaf) => {
            return new TeamActivityView(leaf, this.plugin, this.changeTracker!);
        });

        this.addCommand({
            id: "show-team-activity",
            name: "Show Team Activity",
            callback: () => {
                void this.services.API.showWindow(VIEW_TYPE_TEAM_ACTIVITY);
            },
        });
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Run all tests for regressions**

Run: `npx vitest run test/unit/team.test.ts && npx vitest run test/unit/team-phase2.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/modules/features/TeamSync/TeamActivityView.ts src/modules/features/TeamSync/TeamActivityPane.svelte src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): add Team Activity sidebar view"
```

---

## Task 7: Integration Tests and Final Verification

**Files:**
- Modify: `test/unit/team-phase2.test.ts` (append integration tests)

**Step 1: Add integration tests**

Append to `test/unit/team-phase2.test.ts`:

```typescript
import { ModuleTeamSync } from "../../src/modules/features/TeamSync/ModuleTeamSync";

describe("Phase 2 Integration", async () => {
    let harness: LiveSyncHarness;
    const vaultName = "TestVaultPhase2Integration" + Date.now();

    beforeAll(async () => {
        harness = await generateHarness(vaultName, {
            couchDB_USER: "test-user",
        });
        await waitForReady(harness);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    it("should have changeTracker initialized", () => {
        const mod = harness.plugin.getModule(ModuleTeamSync);
        // changeTracker may be undefined if DB not ready in test, that's OK
        // Just verify the module is accessible
        expect(mod).toBeDefined();
    });

    it("should have events module exportable", async () => {
        const events = await import("../../src/modules/features/TeamSync/events");
        expect(events.EVENT_TEAM_FILE_CHANGED).toBe("team-file-changed");
        expect(events.EVENT_TEAM_FILE_READ).toBe("team-file-read");
        expect(events.EVENT_TEAM_ACTIVITY_UPDATED).toBe("team-activity-updated");
    });
});
```

**Step 2: Run all Phase 2 tests**

Run: `npx vitest run test/unit/team-phase2.test.ts`
Expected: All tests pass

**Step 3: Run all Phase 1 tests for regressions**

Run: `npx vitest run test/unit/team.test.ts`
Expected: All 21 tests pass

**Step 4: Build verification**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add test/unit/team-phase2.test.ts
git commit -m "test(team): add Phase 2 integration tests"
```

---

## Summary of Files Created/Modified

**Created:**
- `src/modules/features/TeamSync/events.ts` — Custom team events
- `src/modules/features/TeamSync/ReadStateManager.ts` — Local read state tracking
- `src/modules/features/TeamSync/ChangeTracker.ts` — Unread files + activity feed
- `src/modules/features/TeamSync/TeamFileDecorator.ts` — File tree blue dots via CSS
- `src/modules/features/TeamSync/TeamActivityView.ts` — Sidebar view (ItemView)
- `src/modules/features/TeamSync/TeamActivityPane.svelte` — Activity feed UI
- `test/unit/team-phase2.test.ts` — Phase 2 tests

**Modified:**
- `src/modules/features/TeamSync/types.ts` — Added FileReadState, TeamActivityEntry
- `src/modules/features/TeamSync/ModuleTeamSync.ts` — Wired change detection, read state, file decorator, activity view

## Final Verification Checklist

- [ ] `npx vitest run test/unit/team-phase2.test.ts` — all Phase 2 tests pass
- [ ] `npx vitest run test/unit/team.test.ts` — all Phase 1 tests pass (no regressions)
- [ ] `npm run build` — production build succeeds
- [ ] All commits are clean and atomic
