# Phase 3: Understanding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-file team diff view, inline diff expansion in the activity sidebar, and filtering by author/date/folder — so team members can see exactly what changed and who changed it.

**Architecture:** Extends Phase 2's `ModuleTeamSync`, `ChangeTracker`, and `TeamActivityPane`. Reuses the codebase's existing `diff_match_patch` library and revision-fetching patterns from `DocumentHistoryModal`. The per-file diff opens in a new Obsidian leaf via `SvelteItemView`. Inline diffs in the activity sidebar use expandable sections. Filtering adds controls to the existing `TeamActivityPane` component.

**Tech Stack:** TypeScript, Svelte 5, `diff_match_patch`, PouchDB revision API, Obsidian ItemView API, CSS

**Key Reference Files:**
- Phase 2 module: `src/modules/features/TeamSync/ModuleTeamSync.ts`
- Phase 2 activity pane: `src/modules/features/TeamSync/TeamActivityPane.svelte`
- Phase 2 change tracker: `src/modules/features/TeamSync/ChangeTracker.ts`
- Phase 2 types: `src/modules/features/TeamSync/types.ts`
- Phase 2 events: `src/modules/features/TeamSync/events.ts`
- Existing diff pattern: `src/modules/features/DocumentHistory/DocumentHistoryModal.ts:139-195`
- Existing diff types: `src/lib/src/common/models/diff.definition.ts`
- diff_match_patch import: `import { diff_match_patch } from "../../../deps.ts"` (re-exported from Obsidian)
- Revision fetching: `db.getRaw(id, { revs_info: true })` and `db.getDBEntry(path, { rev }, false, false, true)`
- SvelteItemView: `src/common/SvelteItemView.ts`
- View registration pattern: `src/modules/features/TeamSync/TeamActivityView.ts`
- Read state manager: `src/modules/features/TeamSync/ReadStateManager.ts`
- Document reading utility: `getDocData` from `src/lib/src/common/utils.ts`
- HTML escaping: `escapeStringToHTML` from `src/lib/src/string_and_binary/convert.ts`
- File menu events: Obsidian's `workspace.on("file-menu", callback)`
- CSS diff classes: `styles.css` has `.added`, `.deleted`, `.history-added`, `.history-deleted`, `.history-normal`

**Phase 2 Dependency:** Requires `ChangeTracker`, `ReadStateManager`, `TeamActivityEntry` type, and team events from Phase 2.

---

## Task 1: Add Diff Service Utility

**Files:**
- Create: `src/modules/features/TeamSync/TeamDiffService.ts`
- Modify: `test/unit/team-phase3.test.ts` (create test file)

This utility class wraps `diff_match_patch` and revision-fetching logic into a clean API that both the diff view and inline diffs can share.

**Step 1: Write the failing test**

Create `test/unit/team-phase3.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TeamDiffService } from "../../src/modules/features/TeamSync/TeamDiffService";

describe("TeamDiffService", () => {
    describe("computeDiff", () => {
        it("should detect insertions", () => {
            const result = TeamDiffService.computeDiff("hello", "hello world");
            expect(result.some(([op]) => op === 1)).toBe(true); // DIFF_INSERT
        });

        it("should detect deletions", () => {
            const result = TeamDiffService.computeDiff("hello world", "hello");
            expect(result.some(([op]) => op === -1)).toBe(true); // DIFF_DELETE
        });

        it("should return equal for identical content", () => {
            const result = TeamDiffService.computeDiff("same", "same");
            expect(result.length).toBe(1);
            expect(result[0][0]).toBe(0); // DIFF_EQUAL
        });

        it("should handle empty strings", () => {
            const result = TeamDiffService.computeDiff("", "new content");
            expect(result.length).toBeGreaterThan(0);
            expect(result[0][0]).toBe(1); // DIFF_INSERT
        });
    });

    describe("computeDiffSummary", () => {
        it("should count added and removed characters", () => {
            const diff = TeamDiffService.computeDiff("hello world", "hello there");
            const summary = TeamDiffService.computeDiffSummary(diff);
            expect(summary.added).toBeGreaterThan(0);
            expect(summary.removed).toBeGreaterThan(0);
        });

        it("should return zero for identical content", () => {
            const diff = TeamDiffService.computeDiff("same", "same");
            const summary = TeamDiffService.computeDiffSummary(diff);
            expect(summary.added).toBe(0);
            expect(summary.removed).toBe(0);
        });
    });

    describe("renderDiffToHtml", () => {
        it("should render deletions with deleted class", () => {
            const diff = TeamDiffService.computeDiff("removed", "");
            const html = TeamDiffService.renderDiffToHtml(diff);
            expect(html).toContain("team-diff-deleted");
        });

        it("should render insertions with added class", () => {
            const diff = TeamDiffService.computeDiff("", "added");
            const html = TeamDiffService.renderDiffToHtml(diff);
            expect(html).toContain("team-diff-added");
        });

        it("should escape HTML in content", () => {
            const diff = TeamDiffService.computeDiff("", "<script>alert('xss')</script>");
            const html = TeamDiffService.renderDiffToHtml(diff);
            expect(html).not.toContain("<script>");
            expect(html).toContain("&lt;script&gt;");
        });
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/team-phase3.test.ts`
Expected: FAIL — TeamDiffService doesn't exist

**Step 3: Create TeamDiffService**

```typescript
// src/modules/features/TeamSync/TeamDiffService.ts

import { diff_match_patch } from "../../../deps.ts";

// DMP operation constants
const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

export type DiffOperation = [number, string]; // [op, text]

export interface DiffSummary {
    added: number;
    removed: number;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Utility for computing and rendering diffs between document revisions.
 * Wraps diff_match_patch with team-specific rendering.
 *
 * All static methods — no instance state needed.
 */
export class TeamDiffService {
    /**
     * Compute a diff between two strings.
     * Returns array of [operation, text] pairs.
     */
    static computeDiff(oldText: string, newText: string): DiffOperation[] {
        const dmp = new diff_match_patch();
        const diff = dmp.diff_main(oldText, newText);
        dmp.diff_cleanupSemantic(diff);
        return diff;
    }

    /**
     * Summarise a diff: count of added and removed characters.
     */
    static computeDiffSummary(diff: DiffOperation[]): DiffSummary {
        let added = 0;
        let removed = 0;
        for (const [op, text] of diff) {
            if (op === DIFF_INSERT) added += text.length;
            else if (op === DIFF_DELETE) removed += text.length;
        }
        return { added, removed };
    }

    /**
     * Render a diff to an HTML string with colour-coded spans.
     * Uses CSS classes: team-diff-added, team-diff-deleted, team-diff-equal.
     */
    static renderDiffToHtml(diff: DiffOperation[]): string {
        let html = "";
        for (const [op, text] of diff) {
            const escaped = escapeHtml(text);
            if (op === DIFF_DELETE) {
                html += `<span class="team-diff-deleted">${escaped}</span>`;
            } else if (op === DIFF_INSERT) {
                html += `<span class="team-diff-added">${escaped}</span>`;
            } else {
                html += `<span class="team-diff-equal">${escaped}</span>`;
            }
        }
        return html.replace(/\n/g, "<br>");
    }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/team-phase3.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/TeamDiffService.ts test/unit/team-phase3.test.ts
git commit -m "feat(team): add TeamDiffService for diff computation and rendering"
```

---

## Task 2: Add Team Diff CSS Styles

**Files:**
- Modify: `styles.css` (append team diff styles)

The codebase has existing diff CSS classes (`.added`, `.deleted`, `.history-added`, etc.) in `styles.css`. We add team-specific classes to avoid collisions.

**Step 1: Append team diff styles**

Append to `styles.css`:

```css
/* Team Diff Styles */
.team-diff-added {
    background-color: var(--background-modifier-success);
    color: var(--text-normal);
}
.team-diff-deleted {
    background-color: var(--background-modifier-error);
    color: var(--text-normal);
    text-decoration: line-through;
}
.team-diff-equal {
    color: var(--text-normal);
}

/* Team Diff View */
.team-diff-view {
    padding: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
}
.team-diff-header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.team-diff-header-file {
    font-weight: 600;
    flex: 1;
}
.team-diff-header-authors {
    font-size: 0.85em;
    color: var(--text-muted);
}
.team-diff-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.5;
}
.team-diff-summary {
    padding: 6px 12px;
    font-size: 0.85em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
}

/* Inline diff in activity sidebar */
.team-activity-diff-toggle {
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.8em;
    padding: 2px 4px;
    border-radius: 3px;
}
.team-activity-diff-toggle:hover {
    background: var(--background-modifier-hover);
}
.team-activity-inline-diff {
    margin: 4px 0 4px 36px;
    padding: 8px;
    background: var(--background-secondary);
    border-radius: 4px;
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.4;
    max-height: 200px;
    overflow-y: auto;
}
.team-activity-diff-summary {
    font-size: 0.75em;
    color: var(--text-muted);
    margin-left: 36px;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add styles.css
git commit -m "feat(team): add CSS styles for team diff views"
```

---

## Task 3: Per-File Team Diff View

**Files:**
- Create: `src/modules/features/TeamSync/TeamDiffPane.svelte`
- Create: `src/modules/features/TeamSync/TeamDiffView.ts`

This creates a side panel view that shows the diff between the user's last-seen revision and the current revision of a file, with author attribution.

**Step 1: Create the Svelte component**

Create `src/modules/features/TeamSync/TeamDiffPane.svelte`:

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { TeamDiffService } from "./TeamDiffService";

    type Props = {
        filePath: string;
        oldContent: string;
        newContent: string;
        oldRev: string;
        newRev: string;
        authors: string[];
        oldMtime: number;
        newMtime: number;
    };

    const {
        filePath,
        oldContent,
        newContent,
        oldRev,
        newRev,
        authors,
        oldMtime,
        newMtime,
    }: Props = $props();

    let diffHtml = $state("");
    let summary = $state({ added: 0, removed: 0 });

    onMount(() => {
        const diff = TeamDiffService.computeDiff(oldContent, newContent);
        diffHtml = TeamDiffService.renderDiffToHtml(diff);
        summary = TeamDiffService.computeDiffSummary(diff);
    });

    function fileName(path: string): string {
        return path.split("/").pop() ?? path;
    }

    function formatTime(ts: number): string {
        return new Date(ts).toLocaleString();
    }
</script>

<div class="team-diff-view">
    <div class="team-diff-header">
        <div class="team-diff-header-file">{fileName(filePath)}</div>
        <div class="team-diff-header-authors">
            by {authors.join(", ")}
        </div>
    </div>
    <div class="team-diff-summary">
        {oldRev.substring(0, 8)} ({formatTime(oldMtime)}) → {newRev.substring(0, 8)} ({formatTime(newMtime)})
        &nbsp;|&nbsp;
        <span class="team-diff-added">+{summary.added}</span>
        &nbsp;
        <span class="team-diff-deleted">-{summary.removed}</span>
    </div>
    <div class="team-diff-content">
        {@html diffHtml}
    </div>
</div>
```

**Step 2: Create the view class**

Create `src/modules/features/TeamSync/TeamDiffView.ts`:

```typescript
import { WorkspaceLeaf } from "@/deps.ts";
import TeamDiffPane from "./TeamDiffPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";

export const VIEW_TYPE_TEAM_DIFF = "team-diff";

export interface TeamDiffViewState {
    filePath: string;
    oldContent: string;
    newContent: string;
    oldRev: string;
    newRev: string;
    authors: string[];
    oldMtime: number;
    newMtime: number;
}

export class TeamDiffView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "diff";
    title = "";
    navigation = true;
    private _state: TeamDiffViewState;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin, state: TeamDiffViewState) {
        super(leaf);
        this.plugin = plugin;
        this._state = state;
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamDiffPane, {
            target,
            props: {
                filePath: this._state.filePath,
                oldContent: this._state.oldContent,
                newContent: this._state.newContent,
                oldRev: this._state.oldRev,
                newRev: this._state.newRev,
                authors: this._state.authors,
                oldMtime: this._state.oldMtime,
                newMtime: this._state.newMtime,
            },
        });
    }

    getIcon(): string {
        return "diff";
    }

    getViewType(): string {
        return VIEW_TYPE_TEAM_DIFF;
    }

    getDisplayText(): string {
        const name = this._state.filePath.split("/").pop() ?? "Diff";
        return `Team Changes: ${name}`;
    }
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/modules/features/TeamSync/TeamDiffPane.svelte src/modules/features/TeamSync/TeamDiffView.ts
git commit -m "feat(team): add per-file team diff view and component"
```

---

## Task 4: Wire Diff View into ModuleTeamSync

**Files:**
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts`

This task adds the diff view registration, the file context menu item, and a method to open the diff view for a file.

**Step 1: Add imports**

Add to the imports in `ModuleTeamSync.ts`:

```typescript
import { TeamDiffView, VIEW_TYPE_TEAM_DIFF, type TeamDiffViewState } from "./TeamDiffView.ts";
import { TeamDiffService } from "./TeamDiffService.ts";
import { getDocData } from "../../../lib/src/common/utils.ts";
```

**Step 2: Add the diff view opening method**

Add this method to the `ModuleTeamSync` class:

```typescript
    /**
     * Open a team diff view for a file.
     * Shows diff between last-seen revision and current revision.
     */
    async openTeamDiff(filePath: string): Promise<void> {
        const db = this.localDatabase;
        const pathWithPrefix = filePath as FilePathWithPrefix;

        // Get current entry
        const currentEntry = await this.core.databaseFileAccess.fetchEntry(pathWithPrefix, undefined, true, true);
        if (currentEntry === false) {
            this._log("Cannot load current revision for diff", LOG_LEVEL_INFO);
            return;
        }

        const currentRev = currentEntry._rev ?? "";
        const currentContent = typeof currentEntry.data === "string"
            ? currentEntry.data
            : getDocData(currentEntry.data);
        const currentMtime = currentEntry.mtime;

        // Get last-seen revision from read state
        let oldContent = "";
        let oldRev = "";
        let oldMtime = 0;
        const readState = await this.readStateManager?.getReadState(filePath);

        if (readState && readState.lastSeenRev !== currentRev) {
            // Fetch the old revision
            try {
                const oldEntry = await this.core.databaseFileAccess.fetchEntry(
                    pathWithPrefix, readState.lastSeenRev, true, true
                );
                if (oldEntry !== false) {
                    oldRev = readState.lastSeenRev;
                    oldContent = typeof oldEntry.data === "string"
                        ? oldEntry.data
                        : getDocData(oldEntry.data);
                    oldMtime = oldEntry.mtime;
                }
            } catch {
                // Old revision may have been compacted — fall back to empty
            }
        }

        // Collect authors from activity feed
        const authors: string[] = [];
        if (this.changeTracker) {
            const feed = this.changeTracker.getActivityFeed();
            for (const entry of feed) {
                if (entry.filePath === filePath && !authors.includes(entry.modifiedBy)) {
                    authors.push(entry.modifiedBy);
                }
            }
        }
        if (authors.length === 0) authors.push("Unknown");

        // Open in a new leaf
        const leaf = this.app.workspace.getLeaf("tab");
        const state: TeamDiffViewState = {
            filePath,
            oldContent,
            newContent: currentContent,
            oldRev: oldRev || "(initial)",
            newRev: currentRev,
            authors,
            oldMtime,
            newMtime: currentMtime,
        };

        const view = new TeamDiffView(leaf, this.plugin, state);
        // We need to use the view registration approach:
        // Register the view type, then use activateView pattern
        leaf.open(view);
    }
```

**Step 3: Register diff view and context menu in _everyOnloadStart**

In the `_everyOnloadStart` method, add before the `return Promise.resolve(true)`:

```typescript
        // Register team diff view
        this.registerView(VIEW_TYPE_TEAM_DIFF, (leaf) => {
            // This factory is for Obsidian's view registry.
            // Actual diff views are opened via openTeamDiff() which constructs with state.
            return new TeamDiffView(leaf, this.plugin, {
                filePath: "",
                oldContent: "",
                newContent: "",
                oldRev: "",
                newRev: "",
                authors: [],
                oldMtime: 0,
                newMtime: 0,
            });
        });

        // Add "View Team Changes" to file context menu
        this.plugin.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!this.isTeamModeEnabled() || !this.changeTracker) return;
                if (!this.changeTracker.isUnread(file.path)) return;
                menu.addItem((item) => {
                    item.setTitle("View Team Changes")
                        .setIcon("diff")
                        .onClick(() => {
                            void this.openTeamDiff(file.path);
                        });
                });
            })
        );
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Run all tests for regressions**

Run: `npx vitest run test/unit/team-phase3.test.ts && npx vitest run test/unit/team-phase2.test.ts && npx vitest run test/unit/team.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): wire diff view, context menu, and revision loading"
```

---

## Task 5: Inline Diff Expansion in Activity Sidebar

**Files:**
- Modify: `src/modules/features/TeamSync/TeamActivityPane.svelte`
- Modify: `src/modules/features/TeamSync/TeamActivityView.ts`

This adds a "show diff" toggle to each entry in the activity sidebar. When expanded, it shows a compact inline diff below the entry.

**Step 1: Update the TeamActivityView to pass diff capability**

In `src/modules/features/TeamSync/TeamActivityView.ts`, update the `Props` type in the `instantiateComponent` to add a diff callback:

```typescript
// Add to imports:
import type { TeamDiffViewState } from "./TeamDiffView.ts";

// Update props in instantiateComponent:
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
                onLoadDiff: async (filePath: string, rev: string): Promise<{ html: string; summary: string } | null> => {
                    return await this._loadInlineDiff(filePath, rev);
                },
            },
        });
    }
```

Add the `_loadInlineDiff` private method to `TeamActivityView`:

```typescript
    private async _loadInlineDiff(
        filePath: string,
        rev: string
    ): Promise<{ html: string; summary: string } | null> {
        const db = this.plugin.localDatabase;
        try {
            // Get the revision's content
            const entry = await db.getDBEntry(
                filePath as any,
                { rev },
                false,
                false,
                true
            );
            if (entry === false) return null;

            const newContent = typeof entry.data === "string"
                ? entry.data
                : getDocData(entry.data);

            // Get previous revision
            const id = await this.plugin.services.path.path2id(filePath);
            const rawDoc = await db.getRaw(id, { revs_info: true });
            const revs = (rawDoc._revs_info ?? []).filter(
                (r: any) => r.status === "available"
            );
            const revIndex = revs.findIndex((r: any) => r.rev === rev);

            let oldContent = "";
            if (revIndex >= 0 && revIndex + 1 < revs.length) {
                const prevRev = revs[revIndex + 1].rev;
                const prevEntry = await db.getDBEntry(
                    filePath as any,
                    { rev: prevRev },
                    false,
                    false,
                    true
                );
                if (prevEntry !== false) {
                    oldContent = typeof prevEntry.data === "string"
                        ? prevEntry.data
                        : getDocData(prevEntry.data);
                }
            }

            const { TeamDiffService } = await import("./TeamDiffService.ts");
            const diff = TeamDiffService.computeDiff(oldContent, newContent);
            const html = TeamDiffService.renderDiffToHtml(diff);
            const summary = TeamDiffService.computeDiffSummary(diff);
            return {
                html,
                summary: `+${summary.added} / -${summary.removed}`,
            };
        } catch {
            return null;
        }
    }
```

Add import at top of `TeamActivityView.ts`:

```typescript
import { getDocData } from "../../../lib/src/common/utils.ts";
```

**Step 2: Update TeamActivityPane.svelte to support inline diffs**

Update the Props type and add diff expansion logic:

```svelte
<script lang="ts">
    // Update Props to include onLoadDiff:
    type Props = {
        getActivityFeed: () => TeamActivityEntry[];
        getUnreadFiles: () => Set<string>;
        onOpenFile: (filePath: string) => void;
        onLoadDiff: (filePath: string, rev: string) => Promise<{ html: string; summary: string } | null>;
    };

    const { getActivityFeed, getUnreadFiles, onOpenFile, onLoadDiff }: Props = $props();

    // Add state for expanded diffs
    let expandedDiffs = $state<Map<string, { html: string; summary: string }>>(new Map());
    let loadingDiffs = $state<Set<string>>(new Set());

    async function toggleDiff(entry: TeamActivityEntry) {
        const key = entry.filePath + ":" + entry.rev;
        if (expandedDiffs.has(key)) {
            const next = new Map(expandedDiffs);
            next.delete(key);
            expandedDiffs = next;
            return;
        }

        loadingDiffs = new Set([...loadingDiffs, key]);
        const result = await onLoadDiff(entry.filePath, entry.rev);
        const nextLoading = new Set(loadingDiffs);
        nextLoading.delete(key);
        loadingDiffs = nextLoading;

        if (result) {
            expandedDiffs = new Map([...expandedDiffs, [key, result]]);
        }
    }
</script>
```

In the template, add a diff toggle button and expandable diff section after the existing entry content. Inside each `{#each group.entries as entry}` block, after the closing `</div>` of `team-activity-entry`, add:

```svelte
                <!-- Inline diff toggle + expansion -->
                <div class="team-activity-diff-summary">
                    <span
                        class="team-activity-diff-toggle"
                        onclick={(e) => { e.stopPropagation(); toggleDiff(entry); }}
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => e.key === "Enter" && toggleDiff(entry)}
                    >
                        {#if loadingDiffs.has(entry.filePath + ":" + entry.rev)}
                            Loading...
                        {:else if expandedDiffs.has(entry.filePath + ":" + entry.rev)}
                            ▼ Hide diff ({expandedDiffs.get(entry.filePath + ":" + entry.rev)?.summary})
                        {:else}
                            ▶ Show diff
                        {/if}
                    </span>
                </div>
                {#if expandedDiffs.has(entry.filePath + ":" + entry.rev)}
                    <div class="team-activity-inline-diff">
                        {@html expandedDiffs.get(entry.filePath + ":" + entry.rev)?.html ?? ""}
                    </div>
                {/if}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/modules/features/TeamSync/TeamActivityPane.svelte src/modules/features/TeamSync/TeamActivityView.ts
git commit -m "feat(team): add inline diff expansion in activity sidebar"
```

---

## Task 6: Activity Sidebar Filtering

**Files:**
- Modify: `src/modules/features/TeamSync/TeamActivityPane.svelte`
- Modify: `src/modules/features/TeamSync/TeamActivityView.ts`
- Modify: `src/modules/features/TeamSync/ChangeTracker.ts`

Add filtering controls to the Team Activity sidebar: by author, date range, and folder.

**Step 1: Add getAuthors method to ChangeTracker**

In `src/modules/features/TeamSync/ChangeTracker.ts`, add:

```typescript
    /**
     * Get a list of unique authors from the activity feed.
     */
    getAuthors(): string[] {
        const authors = new Set<string>();
        for (const entry of this._activityFeed) {
            authors.add(entry.modifiedBy);
        }
        return [...authors].sort();
    }
```

**Step 2: Write test for getAuthors**

Append to `test/unit/team-phase3.test.ts`:

```typescript
import { ChangeTracker } from "../../src/modules/features/TeamSync/ChangeTracker";

describe("ChangeTracker filtering", () => {
    it("should return unique authors from activity feed", () => {
        const tracker = new ChangeTracker("me");
        tracker.trackChange("file1.md", "alice", Date.now(), "1-abc");
        tracker.trackChange("file2.md", "bob", Date.now(), "2-def");
        tracker.trackChange("file3.md", "alice", Date.now(), "3-ghi");
        const authors = tracker.getAuthors();
        expect(authors).toContain("alice");
        expect(authors).toContain("bob");
        expect(authors.length).toBe(2);
    });

    it("should return empty array when no activity", () => {
        const tracker = new ChangeTracker("me");
        expect(tracker.getAuthors()).toEqual([]);
    });
});
```

**Step 3: Run test**

Run: `npx vitest run test/unit/team-phase3.test.ts`
Expected: PASS (the getAuthors test should pass after adding the method)

**Step 4: Update TeamActivityView to pass getAuthors**

In `TeamActivityView.ts`, update the `instantiateComponent` props:

```typescript
    instantiateComponent(target: HTMLElement) {
        return mount(TeamActivityPane, {
            target,
            props: {
                getActivityFeed: () => this._tracker.getActivityFeed(),
                getUnreadFiles: () => this._tracker.getUnreadFiles(),
                getAuthors: () => this._tracker.getAuthors(),
                onOpenFile: (filePath: string) => { /* ... existing ... */ },
                onLoadDiff: async (filePath: string, rev: string) => { /* ... existing ... */ },
            },
        });
    }
```

**Step 5: Add filtering UI to TeamActivityPane.svelte**

Update the Props type to include `getAuthors`:

```svelte
    type Props = {
        getActivityFeed: () => TeamActivityEntry[];
        getUnreadFiles: () => Set<string>;
        getAuthors: () => string[];
        onOpenFile: (filePath: string) => void;
        onLoadDiff: (filePath: string, rev: string) => Promise<{ html: string; summary: string } | null>;
    };

    const { getActivityFeed, getUnreadFiles, getAuthors, onOpenFile, onLoadDiff }: Props = $props();
```

Add filter state and logic:

```svelte
    // Filter state
    let filterAuthor = $state<string>("");
    let filterFolder = $state<string>("");
    let filterDateRange = $state<string>("all"); // "all" | "today" | "week" | "month"
    let showFilters = $state(false);

    function getDateCutoff(range: string): number {
        const now = Date.now();
        switch (range) {
            case "today": return now - 86400000;
            case "week": return now - 86400000 * 7;
            case "month": return now - 86400000 * 30;
            default: return 0;
        }
    }

    // Apply filters to the grouped feed
    const filteredFeed = $derived.by(() => {
        const cutoff = getDateCutoff(filterDateRange);
        return feed.filter((entry) => {
            if (filterAuthor && entry.modifiedBy !== filterAuthor) return false;
            if (filterFolder && !entry.filePath.startsWith(filterFolder)) return false;
            if (cutoff && entry.timestamp < cutoff) return false;
            return true;
        });
    });
```

Update `groupedFeed` to use `filteredFeed` instead of `feed`:

```svelte
    const groupedFeed = $derived.by(() => {
        const groups: { date: string; entries: TeamActivityEntry[] }[] = [];
        let currentDate = "";

        for (const entry of filteredFeed) {
            // ... same grouping logic ...
        }
        return groups;
    });
```

Add filter controls in the template after the header:

```svelte
    <div class="team-activity-filter-bar">
        <button
            class="team-activity-filter-toggle"
            onclick={() => showFilters = !showFilters}
        >
            Filter {showFilters ? "▼" : "▶"}
            {#if filterAuthor || filterFolder || filterDateRange !== "all"}
                <span class="team-filter-active-badge"></span>
            {/if}
        </button>
    </div>

    {#if showFilters}
        <div class="team-activity-filters">
            <div class="team-filter-row">
                <label class="team-filter-label">Author</label>
                <select bind:value={filterAuthor} class="team-filter-select">
                    <option value="">All</option>
                    {#each getAuthors() as author}
                        <option value={author}>{author}</option>
                    {/each}
                </select>
            </div>
            <div class="team-filter-row">
                <label class="team-filter-label">Date</label>
                <select bind:value={filterDateRange} class="team-filter-select">
                    <option value="all">All time</option>
                    <option value="today">Today</option>
                    <option value="week">Last 7 days</option>
                    <option value="month">Last 30 days</option>
                </select>
            </div>
            <div class="team-filter-row">
                <label class="team-filter-label">Folder</label>
                <input
                    type="text"
                    bind:value={filterFolder}
                    placeholder="e.g. research/"
                    class="team-filter-input"
                />
            </div>
        </div>
    {/if}
```

Add filter CSS (either inline in the `<style>` block or as separate CSS appended to `styles.css`):

```css
.team-activity-filter-bar {
    padding: 4px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
}
.team-activity-filter-toggle {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.8em;
    padding: 2px 4px;
    display: flex;
    align-items: center;
    gap: 4px;
}
.team-filter-active-badge {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--interactive-accent);
}
.team-activity-filters {
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.team-filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.team-filter-label {
    font-size: 0.8em;
    color: var(--text-muted);
    min-width: 45px;
}
.team-filter-select,
.team-filter-input {
    flex: 1;
    font-size: 0.85em;
}
```

**Step 6: Verify build and run tests**

Run: `npm run build && npx vitest run test/unit/team-phase3.test.ts`
Expected: Build succeeds, tests pass

**Step 7: Commit**

```bash
git add src/modules/features/TeamSync/ChangeTracker.ts src/modules/features/TeamSync/TeamActivityPane.svelte src/modules/features/TeamSync/TeamActivityView.ts test/unit/team-phase3.test.ts
git commit -m "feat(team): add activity sidebar filtering by author, date, and folder"
```

---

## Task 7: Integration Tests and Final Verification

**Files:**
- Modify: `test/unit/team-phase3.test.ts` (append integration tests)

**Step 1: Add integration tests**

Append to `test/unit/team-phase3.test.ts`:

```typescript
describe("Phase 3 Integration", () => {
    it("should export TeamDiffService with all static methods", async () => {
        const { TeamDiffService } = await import(
            "../../src/modules/features/TeamSync/TeamDiffService"
        );
        expect(typeof TeamDiffService.computeDiff).toBe("function");
        expect(typeof TeamDiffService.computeDiffSummary).toBe("function");
        expect(typeof TeamDiffService.renderDiffToHtml).toBe("function");
    });

    it("should export TeamDiffView constants", async () => {
        const { VIEW_TYPE_TEAM_DIFF } = await import(
            "../../src/modules/features/TeamSync/TeamDiffView"
        );
        expect(VIEW_TYPE_TEAM_DIFF).toBe("team-diff");
    });

    it("should compute full diff pipeline", () => {
        const old = "Line 1\nLine 2\nLine 3";
        const cur = "Line 1\nLine 2 modified\nLine 3\nLine 4";
        const diff = TeamDiffService.computeDiff(old, cur);
        const html = TeamDiffService.renderDiffToHtml(diff);
        const summary = TeamDiffService.computeDiffSummary(diff);

        expect(html).toContain("team-diff-added");
        expect(html).toContain("team-diff-deleted");
        expect(summary.added).toBeGreaterThan(0);
        expect(summary.removed).toBeGreaterThan(0);
    });
});
```

**Step 2: Run all Phase 3 tests**

Run: `npx vitest run test/unit/team-phase3.test.ts`
Expected: All tests pass

**Step 3: Run all Phase 1+2 tests for regressions**

Run: `npx vitest run test/unit/team.test.ts && npx vitest run test/unit/team-phase2.test.ts`
Expected: All tests pass

**Step 4: Build verification**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add test/unit/team-phase3.test.ts
git commit -m "test(team): add Phase 3 integration tests"
```
