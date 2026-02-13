# Phase 4: Collaboration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add contextual team communication within documents through annotations with text anchoring, threaded replies, CodeMirror 6 decorations, and an in-Obsidian notification panel.

**Architecture:** Extends the Phase 1-3 `ModuleTeamSync` infrastructure. Annotations are stored as `team:annotation:<id>` documents in CouchDB (synced via normal LiveSync replication). Text anchoring uses a fuzzy context-matching algorithm so annotations survive file edits. The editor integration uses CodeMirror 6 `StateField` + `Decoration.mark` for highlights, registered via Obsidian's `registerEditorExtension()`. A new "Team Notes" sidebar view shows relevant annotations with badge counts.

**Tech Stack:** TypeScript, Svelte 5, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), PouchDB, Obsidian ItemView API, CSS

**Key Reference Files:**
- Team module: `src/modules/features/TeamSync/ModuleTeamSync.ts`
- Team types (includes `TeamAnnotation`): `src/modules/features/TeamSync/types.ts`
- Team events: `src/modules/features/TeamSync/events.ts`
- Config manager pattern: `src/modules/features/TeamSync/TeamConfigManager.ts`
- ReadState manager: `src/modules/features/TeamSync/ReadStateManager.ts`
- SvelteItemView: `src/common/SvelteItemView.ts`
- View registration pattern: `src/modules/features/TeamSync/TeamActivityView.ts`
- File menu pattern: `ModuleTeamSync.ts:246-258`
- PouchDB allDocs prefix query: `src/lib/src/pouchdb/LiveSyncLocalDB.ts:296` (`startkey`/`endkey`)
- Local PouchDB access: `this.localDatabase` (provides `.get()`, `.put()`, `.allDocsRaw()`)
- CM6 types: `@codemirror/state` (`Extension`, `StateField`, `StateEffect`), `@codemirror/view` (`EditorView`, `ViewPlugin`, `Decoration`, `DecorationSet`)
- Obsidian CM6 integration: `plugin.registerEditorExtension(extension)` (obsidian.d.ts:3254)
- Obsidian editor menu: `workspace.on("editor-menu", callback)` (obsidian.d.ts:5011)
- Obsidian StateFields: `editorInfoField` gives current file info from within CM6
- Event hub: `src/common/events.ts` — `eventHub.emitEvent()` / `eventHub.onEvent()`
- CSS styles: `styles.css` (append new annotation styles)

**Important CM6 Notes:**
- This plugin has never used CM6 extensions before. Import directly from `@codemirror/state` and `@codemirror/view`.
- Obsidian does NOT re-export CM6 types — import them from the `@codemirror/*` packages.
- Use `plugin.registerEditorExtension(extensionArray)` to install. Pass a mutable array and call `workspace.updateOptions()` to reconfigure on the fly.
- `editorInfoField` from `obsidian` gives the current file path from within a CM6 extension.

**Existing Type:** The `TeamAnnotation` interface already exists in `types.ts:33-51`:
```typescript
export interface TeamAnnotation {
    _id: `team:annotation:${string}`;
    _rev?: string;
    filePath: string;
    range: { startLine: number; startChar: number; endLine: number; endChar: number; };
    contextBefore: string;
    contextAfter: string;
    content: string;
    author: string;
    mentions: string[];
    timestamp: string;
    resolved: boolean;
    parentId: string | null;
}
```

---

## Task 1: AnnotationStore — CRUD for Annotation Documents

**Files:**
- Create: `src/modules/features/TeamSync/AnnotationStore.ts`
- Create: `test/unit/team-phase4.test.ts`

This class manages `team:annotation:*` documents in PouchDB, following the same pattern as `TeamConfigManager`. It handles create, fetch, query-by-file, query-by-mention, update, and resolve operations.

**Step 1: Write failing tests**

Create `test/unit/team-phase4.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";

// We'll mock PouchDB for store tests
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

describe("AnnotationStore", () => {
    let store: any;
    let mockDB: any;

    beforeEach(async () => {
        const { AnnotationStore } = await import(
            "../../src/modules/features/TeamSync/AnnotationStore"
        );
        mockDB = createMockDB();
        store = new AnnotationStore({ localDatabase: mockDB } as any);
    });

    it("should create an annotation with generated ID", async () => {
        const annotation = await store.create({
            filePath: "notes/test.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 10 },
            contextBefore: "before text",
            contextAfter: "after text",
            content: "This needs a citation",
            author: "alice",
            mentions: ["bob"],
            parentId: null,
        });
        expect(annotation._id).toMatch(/^team:annotation:/);
        expect(annotation.resolved).toBe(false);
        expect(annotation.timestamp).toBeTruthy();
    });

    it("should get annotation by ID", async () => {
        const created = await store.create({
            filePath: "notes/test.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 10 },
            contextBefore: "",
            contextAfter: "",
            content: "test",
            author: "alice",
            mentions: [],
            parentId: null,
        });
        const fetched = await store.getById(created._id);
        expect(fetched).not.toBeNull();
        expect(fetched!.content).toBe("test");
    });

    it("should return null for missing annotation", async () => {
        const result = await store.getById("team:annotation:nonexistent");
        expect(result).toBeNull();
    });

    it("should get annotations by file path", async () => {
        await store.create({
            filePath: "notes/a.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "note on a", author: "alice", mentions: [], parentId: null,
        });
        await store.create({
            filePath: "notes/b.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "note on b", author: "alice", mentions: [], parentId: null,
        });
        const results = await store.getByFile("notes/a.md");
        expect(results.length).toBe(1);
        expect(results[0].content).toBe("note on a");
    });

    it("should resolve an annotation", async () => {
        const created = await store.create({
            filePath: "notes/test.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "test", author: "alice", mentions: [], parentId: null,
        });
        const resolved = await store.resolve(created._id);
        expect(resolved).toBe(true);
        const fetched = await store.getById(created._id);
        expect(fetched!.resolved).toBe(true);
    });

    it("should update annotation content", async () => {
        const created = await store.create({
            filePath: "notes/test.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "original", author: "alice", mentions: [], parentId: null,
        });
        await store.update(created._id, { content: "edited" });
        const fetched = await store.getById(created._id);
        expect(fetched!.content).toBe("edited");
    });

    it("should get annotations mentioning a user", async () => {
        await store.create({
            filePath: "notes/a.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "hey @bob", author: "alice", mentions: ["bob"], parentId: null,
        });
        await store.create({
            filePath: "notes/b.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "hey @charlie", author: "alice", mentions: ["charlie"], parentId: null,
        });
        const results = await store.getByMention("bob");
        expect(results.length).toBe(1);
        expect(results[0].content).toBe("hey @bob");
    });

    it("should get replies for a parent annotation", async () => {
        const parent = await store.create({
            filePath: "notes/a.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "parent", author: "alice", mentions: [], parentId: null,
        });
        await store.create({
            filePath: "notes/a.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "",
            content: "reply", author: "bob", mentions: [], parentId: parent._id,
        });
        const replies = await store.getReplies(parent._id);
        expect(replies.length).toBe(1);
        expect(replies[0].content).toBe("reply");
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase4.test.ts`
Expected: FAIL — `AnnotationStore` doesn't exist

**Step 3: Implement AnnotationStore**

Create `src/modules/features/TeamSync/AnnotationStore.ts`:

```typescript
import type { LiveSyncLocalDB } from "../../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import type { TeamAnnotation } from "./types.ts";

type CreateAnnotationInput = Omit<TeamAnnotation, "_id" | "_rev" | "timestamp" | "resolved">;

/**
 * CRUD for team:annotation:* documents in PouchDB.
 * Documents sync to CouchDB via normal LiveSync replication.
 */
export class AnnotationStore {
    constructor(private db: LiveSyncLocalDB) {}

    private _generateId(): string {
        return `team:annotation:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async create(input: CreateAnnotationInput): Promise<TeamAnnotation> {
        const doc: TeamAnnotation = {
            _id: this._generateId() as `team:annotation:${string}`,
            filePath: input.filePath,
            range: input.range,
            contextBefore: input.contextBefore,
            contextAfter: input.contextAfter,
            content: input.content,
            author: input.author,
            mentions: input.mentions,
            timestamp: new Date().toISOString(),
            resolved: false,
            parentId: input.parentId,
        };
        await this.db.localDatabase.put(doc as any);
        return doc;
    }

    async getById(id: string): Promise<TeamAnnotation | null> {
        try {
            const doc = await this.db.localDatabase.get(id);
            if ((doc as any)._deleted) return null;
            return doc as unknown as TeamAnnotation;
        } catch {
            return null;
        }
    }

    async getByFile(filePath: string): Promise<TeamAnnotation[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:annotation:",
            endkey: "team:annotation:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as TeamAnnotation)
            .filter((a) => a && !a._deleted && a.filePath === filePath);
    }

    async getByMention(username: string): Promise<TeamAnnotation[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:annotation:",
            endkey: "team:annotation:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as TeamAnnotation)
            .filter((a) => a && !a._deleted && a.mentions.includes(username));
    }

    async getReplies(parentId: string): Promise<TeamAnnotation[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:annotation:",
            endkey: "team:annotation:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as TeamAnnotation)
            .filter((a) => a && !a._deleted && a.parentId === parentId);
    }

    async update(id: string, fields: Partial<Pick<TeamAnnotation, "content" | "mentions" | "range" | "contextBefore" | "contextAfter">>): Promise<boolean> {
        const doc = await this.getById(id);
        if (!doc) return false;
        Object.assign(doc, fields);
        await this.db.localDatabase.put(doc as any);
        return true;
    }

    async resolve(id: string): Promise<boolean> {
        const doc = await this.getById(id);
        if (!doc) return false;
        doc.resolved = true;
        await this.db.localDatabase.put(doc as any);
        return true;
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase4.test.ts`
Expected: PASS — all 8 tests

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/AnnotationStore.ts test/unit/team-phase4.test.ts
git commit -m "feat(team): add AnnotationStore for annotation document CRUD"
```

---

## Task 2: TextAnchor — Fuzzy Context Matching for Re-anchoring

**Files:**
- Create: `src/modules/features/TeamSync/TextAnchor.ts`
- Modify: `test/unit/team-phase4.test.ts` (append tests)

Annotations store text positions AND ~50 characters of surrounding context. When a file changes, we use this context to find the new position. If the context can't be found, the annotation is marked orphaned.

**Step 1: Write failing tests**

Append to `test/unit/team-phase4.test.ts`:

```typescript
import { TextAnchor } from "../../src/modules/features/TeamSync/TextAnchor";

describe("TextAnchor", () => {
    describe("captureContext", () => {
        it("should capture surrounding context from document text", () => {
            const text = "Line one\nLine two has some content here\nLine three";
            // Anchor to "some content" (characters 14-26 on line 1, 0-indexed)
            const ctx = TextAnchor.captureContext(text, { startLine: 1, startChar: 14, endLine: 1, endChar: 26 });
            expect(ctx.selectedText).toBe("some content");
            expect(ctx.contextBefore.length).toBeGreaterThan(0);
            expect(ctx.contextAfter.length).toBeGreaterThan(0);
        });

        it("should handle selection at start of document", () => {
            const text = "Hello world\nSecond line";
            const ctx = TextAnchor.captureContext(text, { startLine: 0, startChar: 0, endLine: 0, endChar: 5 });
            expect(ctx.selectedText).toBe("Hello");
            expect(ctx.contextBefore).toBe("");
        });

        it("should handle selection at end of document", () => {
            const text = "First line\nLast";
            const ctx = TextAnchor.captureContext(text, { startLine: 1, startChar: 0, endLine: 1, endChar: 4 });
            expect(ctx.selectedText).toBe("Last");
            expect(ctx.contextAfter).toBe("");
        });
    });

    describe("findAnchor", () => {
        it("should find exact match at original position", () => {
            const text = "Line one\nLine two has some content here\nLine three";
            const result = TextAnchor.findAnchor(text, {
                selectedText: "some content",
                contextBefore: "Line two has ",
                contextAfter: " here",
                originalRange: { startLine: 1, startChar: 14, endLine: 1, endChar: 26 },
            });
            expect(result).not.toBeNull();
            expect(result!.startLine).toBe(1);
            expect(result!.startChar).toBe(14);
        });

        it("should find text after lines were inserted above", () => {
            const original = "AAA\nBBB target text CCC\nDDD";
            const modified = "AAA\nNew line\nBBB target text CCC\nDDD";
            const result = TextAnchor.findAnchor(modified, {
                selectedText: "target text",
                contextBefore: "BBB ",
                contextAfter: " CCC",
                originalRange: { startLine: 1, startChar: 4, endLine: 1, endChar: 15 },
            });
            expect(result).not.toBeNull();
            expect(result!.startLine).toBe(2); // shifted down by 1
        });

        it("should find text with partial context match", () => {
            const text = "Some prefix changed target text suffix changed end";
            const result = TextAnchor.findAnchor(text, {
                selectedText: "target text",
                contextBefore: "original prefix ",
                contextAfter: " original suffix",
                originalRange: { startLine: 0, startChar: 0, endLine: 0, endChar: 11 },
            });
            // Should still find "target text" by searching for the selected text itself
            expect(result).not.toBeNull();
        });

        it("should return null when text is completely gone (orphaned)", () => {
            const text = "Completely different content with nothing matching";
            const result = TextAnchor.findAnchor(text, {
                selectedText: "target text that was deleted",
                contextBefore: "original before ",
                contextAfter: " original after",
                originalRange: { startLine: 5, startChar: 0, endLine: 5, endChar: 28 },
            });
            expect(result).toBeNull();
        });
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase4.test.ts`
Expected: FAIL — `TextAnchor` doesn't exist

**Step 3: Implement TextAnchor**

Create `src/modules/features/TeamSync/TextAnchor.ts`:

```typescript
const CONTEXT_CHARS = 50;

export interface AnchorRange {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
}

export interface AnchorContext {
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    originalRange: AnchorRange;
}

/**
 * Utility for text anchoring and re-anchoring of annotations.
 *
 * Captures ~50 characters of surrounding context when creating an annotation.
 * Uses that context to fuzzy-find the position when the document changes.
 * Returns null (orphaned) when text can't be found.
 */
export class TextAnchor {
    /**
     * Capture context around a selection in a document.
     */
    static captureContext(docText: string, range: AnchorRange): {
        selectedText: string;
        contextBefore: string;
        contextAfter: string;
    } {
        const lines = docText.split("\n");

        // Convert line/char to absolute offset
        const startOffset = TextAnchor._toOffset(lines, range.startLine, range.startChar);
        const endOffset = TextAnchor._toOffset(lines, range.endLine, range.endChar);

        const selectedText = docText.slice(startOffset, endOffset);
        const beforeStart = Math.max(0, startOffset - CONTEXT_CHARS);
        const afterEnd = Math.min(docText.length, endOffset + CONTEXT_CHARS);

        return {
            selectedText,
            contextBefore: docText.slice(beforeStart, startOffset),
            contextAfter: docText.slice(endOffset, afterEnd),
        };
    }

    /**
     * Find the anchor position in (possibly modified) document text.
     * Returns null if the text is orphaned (can't be found).
     *
     * Strategy:
     * 1. Try exact match of contextBefore + selectedText + contextAfter
     * 2. Try selectedText with contextBefore or contextAfter
     * 3. Try selectedText alone
     * 4. Return null (orphaned)
     */
    static findAnchor(docText: string, anchor: AnchorContext): AnchorRange | null {
        const { selectedText, contextBefore, contextAfter } = anchor;
        const lines = docText.split("\n");

        // Strategy 1: Full context match
        const fullPattern = contextBefore + selectedText + contextAfter;
        let idx = docText.indexOf(fullPattern);
        if (idx !== -1) {
            const selStart = idx + contextBefore.length;
            const selEnd = selStart + selectedText.length;
            return TextAnchor._toRange(lines, selStart, selEnd);
        }

        // Strategy 2: contextBefore + selectedText
        if (contextBefore) {
            const pattern2 = contextBefore + selectedText;
            idx = docText.indexOf(pattern2);
            if (idx !== -1) {
                const selStart = idx + contextBefore.length;
                const selEnd = selStart + selectedText.length;
                return TextAnchor._toRange(lines, selStart, selEnd);
            }
        }

        // Strategy 3: selectedText + contextAfter
        if (contextAfter) {
            const pattern3 = selectedText + contextAfter;
            idx = docText.indexOf(pattern3);
            if (idx !== -1) {
                return TextAnchor._toRange(lines, idx, idx + selectedText.length);
            }
        }

        // Strategy 4: selectedText alone
        idx = docText.indexOf(selectedText);
        if (idx !== -1) {
            return TextAnchor._toRange(lines, idx, idx + selectedText.length);
        }

        // Orphaned
        return null;
    }

    /** Convert line/char to absolute offset. */
    static _toOffset(lines: string[], line: number, char: number): number {
        let offset = 0;
        for (let i = 0; i < line && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for \n
        }
        return offset + char;
    }

    /** Convert absolute offsets to line/char range. */
    static _toRange(lines: string[], startOffset: number, endOffset: number): AnchorRange {
        let offset = 0;
        let startLine = 0, startChar = 0, endLine = 0, endChar = 0;
        let foundStart = false;

        for (let i = 0; i < lines.length; i++) {
            const lineEnd = offset + lines[i].length;
            if (!foundStart && startOffset <= lineEnd) {
                startLine = i;
                startChar = startOffset - offset;
                foundStart = true;
            }
            if (foundStart && endOffset <= lineEnd) {
                endLine = i;
                endChar = endOffset - offset;
                break;
            }
            offset = lineEnd + 1; // +1 for \n
        }

        return { startLine, startChar, endLine, endChar };
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase4.test.ts`
Expected: PASS — all tests

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/TextAnchor.ts test/unit/team-phase4.test.ts
git commit -m "feat(team): add TextAnchor for fuzzy re-anchoring of annotations"
```

---

## Task 3: Annotation Events

**Files:**
- Modify: `src/modules/features/TeamSync/events.ts`

Add events for annotation lifecycle.

**Step 1: Add annotation events**

Append to `src/modules/features/TeamSync/events.ts`:

```typescript
export const EVENT_TEAM_ANNOTATION_CREATED = "team-annotation-created" as const;
export const EVENT_TEAM_ANNOTATION_UPDATED = "team-annotation-updated" as const;
export const EVENT_TEAM_ANNOTATION_RESOLVED = "team-annotation-resolved" as const;
```

Also add them to the `LSEvents` declaration merge in the same file (follow existing pattern).

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/modules/features/TeamSync/events.ts
git commit -m "feat(team): add annotation lifecycle events"
```

---

## Task 4: Annotation CSS Styles

**Files:**
- Modify: `styles.css` (append annotation styles)

**Step 1: Append annotation styles**

Append to `styles.css`:

```css
/* Team Annotation Styles */

/* CM6 editor highlight for annotated text */
.team-annotation-highlight {
    background-color: rgba(255, 215, 0, 0.25);
    border-bottom: 2px solid rgba(255, 215, 0, 0.6);
    cursor: pointer;
}
.team-annotation-highlight:hover {
    background-color: rgba(255, 215, 0, 0.4);
}
.team-annotation-highlight.is-resolved {
    background-color: rgba(128, 128, 128, 0.15);
    border-bottom-color: rgba(128, 128, 128, 0.3);
}

/* Annotation tooltip (shown on hover) */
.team-annotation-tooltip {
    position: absolute;
    z-index: 100;
    max-width: 300px;
    padding: 8px 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    font-size: 0.85em;
    line-height: 1.4;
}
.team-annotation-tooltip-author {
    font-weight: 600;
    margin-bottom: 4px;
}
.team-annotation-tooltip-time {
    font-size: 0.8em;
    color: var(--text-muted);
}
.team-annotation-tooltip-content {
    margin-top: 4px;
}

/* Annotation popover (shown on click — create/view/reply) */
.team-annotation-popover {
    position: absolute;
    z-index: 200;
    width: 320px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    padding: 12px;
}
.team-annotation-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--background-modifier-border);
}
.team-annotation-popover-author {
    font-weight: 600;
    font-size: 0.9em;
}
.team-annotation-popover-time {
    font-size: 0.75em;
    color: var(--text-muted);
}
.team-annotation-popover-content {
    font-size: 0.9em;
    margin-bottom: 8px;
    white-space: pre-wrap;
}
.team-annotation-popover-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}

/* Thread (replies) */
.team-annotation-thread {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
}
.team-annotation-reply {
    padding: 6px 0;
    font-size: 0.85em;
    border-bottom: 1px solid var(--background-modifier-border-hover);
}
.team-annotation-reply:last-child {
    border-bottom: none;
}
.team-annotation-reply-author {
    font-weight: 600;
    font-size: 0.85em;
}
.team-annotation-reply-time {
    font-size: 0.75em;
    color: var(--text-muted);
    margin-left: 4px;
}
.team-annotation-reply-content {
    margin-top: 2px;
}

/* Reply input */
.team-annotation-reply-input {
    width: 100%;
    min-height: 60px;
    margin-top: 8px;
    padding: 6px 8px;
    font-size: 0.85em;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-secondary);
    resize: vertical;
}
.team-annotation-reply-submit {
    margin-top: 4px;
}

/* @mention highlight in annotation text */
.team-annotation-mention {
    color: var(--interactive-accent);
    font-weight: 600;
}

/* Team Notes sidebar */
.team-notes {
    padding: 0;
    overflow-y: auto;
    height: 100%;
}
.team-notes-header {
    padding: 8px 12px;
    margin: 0;
    border-bottom: 1px solid var(--background-modifier-border);
    position: sticky;
    top: 0;
    background: var(--background-primary);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.team-notes-badge {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 10px;
    padding: 0 6px;
    font-size: 0.75em;
    font-weight: 600;
    min-width: 18px;
    text-align: center;
}
.team-notes-empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--text-muted);
}
.team-notes-entry {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--background-modifier-border);
}
.team-notes-entry:hover {
    background: var(--background-modifier-hover);
}
.team-notes-entry.is-unread {
    background: var(--background-modifier-hover);
}
.team-notes-entry-file {
    font-size: 0.8em;
    color: var(--text-muted);
    margin-bottom: 2px;
}
.team-notes-entry-content {
    font-size: 0.9em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.team-notes-entry-meta {
    font-size: 0.75em;
    color: var(--text-muted);
    margin-top: 2px;
}
.team-notes-tabs {
    display: flex;
    border-bottom: 1px solid var(--background-modifier-border);
}
.team-notes-tab {
    flex: 1;
    padding: 6px 12px;
    text-align: center;
    font-size: 0.85em;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    color: var(--text-muted);
}
.team-notes-tab.is-active {
    color: var(--text-normal);
    border-bottom-color: var(--interactive-accent);
}
.team-notes-filter-bar {
    padding: 4px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    display: flex;
    gap: 8px;
    align-items: center;
}
.team-notes-filter-select {
    font-size: 0.8em;
    flex: 1;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add styles.css
git commit -m "feat(team): add CSS styles for annotations and Team Notes sidebar"
```

---

## Task 5: CM6 Annotation Extension — Editor Decorations

**Files:**
- Create: `src/modules/features/TeamSync/AnnotationExtension.ts`

This creates the CodeMirror 6 extension that highlights annotated text in the editor. It uses a `StateField` to hold annotations for the current file, `StateEffect` to update them, and `Decoration.mark` for visual highlights.

**Step 1: Create the CM6 extension**

Create `src/modules/features/TeamSync/AnnotationExtension.ts`:

```typescript
import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { AnchorRange } from "./TextAnchor.ts";

export interface EditorAnnotation {
    id: string;
    range: AnchorRange;
    content: string;
    author: string;
    resolved: boolean;
    replyCount: number;
}

/** Effect to replace all annotations for the current file. */
export const setAnnotationsEffect = StateEffect.define<EditorAnnotation[]>();

/** Effect to clear all annotations (e.g., on file close). */
export const clearAnnotationsEffect = StateEffect.define<void>();

/**
 * StateField holding the current file's annotations as a DecorationSet.
 */
const annotationField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        // Check for effects
        for (const e of tr.effects) {
            if (e.is(clearAnnotationsEffect)) {
                return Decoration.none;
            }
            if (e.is(setAnnotationsEffect)) {
                return buildDecorations(tr.state.doc, e.value);
            }
        }
        // Map through document changes
        return decorations.map(tr.changes);
    },
    provide(field) {
        return EditorView.decorations.from(field);
    },
});

function buildDecorations(doc: any, annotations: EditorAnnotation[]): DecorationSet {
    const decorations: any[] = [];

    for (const ann of annotations) {
        try {
            const from = lineCharToOffset(doc, ann.range.startLine, ann.range.startChar);
            const to = lineCharToOffset(doc, ann.range.endLine, ann.range.endChar);
            if (from >= 0 && to > from && to <= doc.length) {
                const cls = ann.resolved
                    ? "team-annotation-highlight is-resolved"
                    : "team-annotation-highlight";
                decorations.push(
                    Decoration.mark({
                        class: cls,
                        attributes: {
                            "data-annotation-id": ann.id,
                            title: `${ann.author}: ${ann.content.slice(0, 60)}`,
                        },
                    }).range(from, to)
                );
            }
        } catch {
            // Skip annotations that can't be positioned (orphaned or out of range)
        }
    }

    // Decorations must be sorted by position
    decorations.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(decorations);
}

function lineCharToOffset(doc: any, line: number, char: number): number {
    // CM6 lines are 1-based
    const lineObj = doc.line(line + 1);
    return lineObj.from + char;
}

/**
 * Create the CM6 extension array for annotation highlights.
 * Returns a mutable array — push/splice to reconfigure, then call workspace.updateOptions().
 */
export function createAnnotationExtension(): Extension[] {
    return [annotationField];
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/modules/features/TeamSync/AnnotationExtension.ts
git commit -m "feat(team): add CM6 annotation extension for editor highlights"
```

---

## Task 6: AnnotationPopover — Svelte Component for Create/View/Reply

**Files:**
- Create: `src/modules/features/TeamSync/AnnotationPopover.svelte`

This Svelte 5 component renders a popover anchored to annotated text. It shows the annotation content, author, timestamp, replies thread, and a reply input. It also supports creating new annotations.

**Step 1: Create the popover component**

Create `src/modules/features/TeamSync/AnnotationPopover.svelte`:

```svelte
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { TeamAnnotation } from "./types";

    type Props = {
        mode: "create" | "view";
        annotation?: TeamAnnotation;
        replies?: TeamAnnotation[];
        members?: string[];
        anchorEl: HTMLElement;
        onSubmit: (content: string, mentions: string[]) => void;
        onReply: (content: string, mentions: string[]) => void;
        onResolve: () => void;
        onClose: () => void;
    };

    const {
        mode,
        annotation,
        replies = [],
        members = [],
        anchorEl,
        onSubmit,
        onReply,
        onResolve,
        onClose,
    }: Props = $props();

    let content = $state("");
    let replyContent = $state("");
    let popoverEl: HTMLElement | undefined = $state();

    function parseMentions(text: string): string[] {
        const matches = text.match(/@(\w+)/g);
        if (!matches) return [];
        return [...new Set(matches.map((m) => m.slice(1)))];
    }

    function handleSubmit() {
        if (!content.trim()) return;
        onSubmit(content, parseMentions(content));
    }

    function handleReply() {
        if (!replyContent.trim()) return;
        onReply(replyContent, parseMentions(replyContent));
        replyContent = "";
    }

    function formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
            " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function positionPopover() {
        if (!popoverEl || !anchorEl) return;
        const rect = anchorEl.getBoundingClientRect();
        popoverEl.style.top = `${rect.bottom + 4}px`;
        popoverEl.style.left = `${Math.max(8, rect.left)}px`;
    }

    function handleClickOutside(e: MouseEvent) {
        if (popoverEl && !popoverEl.contains(e.target as Node)) {
            onClose();
        }
    }

    onMount(() => {
        positionPopover();
        document.addEventListener("mousedown", handleClickOutside);
    });

    onDestroy(() => {
        document.removeEventListener("mousedown", handleClickOutside);
    });
</script>

<div class="team-annotation-popover" bind:this={popoverEl}>
    {#if mode === "create"}
        <div class="team-annotation-popover-header">
            <span class="team-annotation-popover-author">Add Team Note</span>
        </div>
        <textarea
            class="team-annotation-reply-input"
            bind:value={content}
            placeholder="Type your note... Use @username to mention"
        ></textarea>
        <div class="team-annotation-popover-actions">
            <button class="team-annotation-reply-submit" onclick={handleSubmit}>Add Note</button>
            <button onclick={onClose}>Cancel</button>
        </div>
    {:else if annotation}
        <div class="team-annotation-popover-header">
            <span class="team-annotation-popover-author">{annotation.author}</span>
            <span class="team-annotation-popover-time">{formatTime(annotation.timestamp)}</span>
        </div>
        <div class="team-annotation-popover-content">{annotation.content}</div>
        <div class="team-annotation-popover-actions">
            {#if !annotation.resolved}
                <button onclick={onResolve}>Resolve</button>
            {:else}
                <span style="color: var(--text-muted); font-size: 0.85em;">Resolved</span>
            {/if}
        </div>

        {#if replies.length > 0}
            <div class="team-annotation-thread">
                {#each replies as reply}
                    <div class="team-annotation-reply">
                        <span class="team-annotation-reply-author">{reply.author}</span>
                        <span class="team-annotation-reply-time">{formatTime(reply.timestamp)}</span>
                        <div class="team-annotation-reply-content">{reply.content}</div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if !annotation.resolved}
            <textarea
                class="team-annotation-reply-input"
                bind:value={replyContent}
                placeholder="Reply... Use @username to mention"
            ></textarea>
            <button class="team-annotation-reply-submit" onclick={handleReply}>Reply</button>
        {/if}
    {/if}
</div>
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/modules/features/TeamSync/AnnotationPopover.svelte
git commit -m "feat(team): add AnnotationPopover component for create/view/reply"
```

---

## Task 7: Team Notes Sidebar — SvelteItemView

**Files:**
- Create: `src/modules/features/TeamSync/TeamNotesPane.svelte`
- Create: `src/modules/features/TeamSync/TeamNotesView.ts`

A sidebar panel showing annotations relevant to the current user: mentions, annotations on recently-edited files, and an option to filter by resolved status. Badge count for unread.

**Step 1: Create the Svelte component**

Create `src/modules/features/TeamSync/TeamNotesPane.svelte`:

```svelte
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { TeamAnnotation } from "./types";
    import { eventHub } from "../../../common/events";
    import {
        EVENT_TEAM_ANNOTATION_CREATED,
        EVENT_TEAM_ANNOTATION_UPDATED,
        EVENT_TEAM_ANNOTATION_RESOLVED,
    } from "./events";

    type Props = {
        getMentions: () => Promise<TeamAnnotation[]>;
        getRecent: () => Promise<TeamAnnotation[]>;
        onOpenAnnotation: (annotation: TeamAnnotation) => void;
        onResolve: (annotationId: string) => Promise<void>;
    };

    const { getMentions, getRecent, onOpenAnnotation, onResolve }: Props = $props();

    let activeTab = $state<"mentions" | "recent">("mentions");
    let annotations = $state<TeamAnnotation[]>([]);
    let showResolved = $state(false);
    let disposers: (() => void)[] = [];

    const filteredAnnotations = $derived.by(() => {
        if (showResolved) return annotations;
        return annotations.filter((a) => !a.resolved);
    });

    const unreadCount = $derived(annotations.filter((a) => !a.resolved).length);

    async function refresh() {
        if (activeTab === "mentions") {
            annotations = await getMentions();
        } else {
            annotations = await getRecent();
        }
    }

    function handleTabChange(tab: "mentions" | "recent") {
        activeTab = tab;
        void refresh();
    }

    function formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
            " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function fileName(path: string): string {
        return path.split("/").pop() ?? path;
    }

    async function handleResolve(e: MouseEvent, id: string) {
        e.stopPropagation();
        await onResolve(id);
        void refresh();
    }

    onMount(() => {
        void refresh();
        disposers.push(
            eventHub.onEvent(EVENT_TEAM_ANNOTATION_CREATED, () => void refresh()),
            eventHub.onEvent(EVENT_TEAM_ANNOTATION_UPDATED, () => void refresh()),
            eventHub.onEvent(EVENT_TEAM_ANNOTATION_RESOLVED, () => void refresh())
        );
    });

    onDestroy(() => {
        for (const dispose of disposers) dispose();
        disposers = [];
    });
</script>

<div class="team-notes">
    <div class="team-notes-header">
        <h4 style="margin: 0;">Team Notes</h4>
        {#if unreadCount > 0}
            <span class="team-notes-badge">{unreadCount}</span>
        {/if}
    </div>

    <div class="team-notes-tabs">
        <button
            class="team-notes-tab"
            class:is-active={activeTab === "mentions"}
            onclick={() => handleTabChange("mentions")}
        >Mentions</button>
        <button
            class="team-notes-tab"
            class:is-active={activeTab === "recent"}
            onclick={() => handleTabChange("recent")}
        >Recent</button>
    </div>

    <div class="team-notes-filter-bar">
        <label style="font-size: 0.8em; color: var(--text-muted);">
            <input type="checkbox" bind:checked={showResolved} />
            Show resolved
        </label>
    </div>

    {#if filteredAnnotations.length === 0}
        <div class="team-notes-empty">No team notes yet.</div>
    {:else}
        {#each filteredAnnotations as ann}
            <div
                class="team-notes-entry"
                class:is-unread={!ann.resolved}
                onclick={() => onOpenAnnotation(ann)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === "Enter" && onOpenAnnotation(ann)}
            >
                <div class="team-notes-entry-file">{fileName(ann.filePath)}</div>
                <div class="team-notes-entry-content">{ann.content}</div>
                <div class="team-notes-entry-meta">
                    {ann.author} &middot; {formatTime(ann.timestamp)}
                    {#if !ann.resolved}
                        &middot; <span
                            style="cursor: pointer; color: var(--interactive-accent);"
                            onclick={(e) => handleResolve(e, ann._id)}
                            role="button"
                            tabindex="0"
                            onkeydown={(e) => e.key === "Enter" && handleResolve(e, ann._id)}
                        >Resolve</span>
                    {/if}
                </div>
            </div>
        {/each}
    {/if}
</div>
```

**Step 2: Create the view class**

Create `src/modules/features/TeamSync/TeamNotesView.ts`:

```typescript
import { WorkspaceLeaf } from "@/deps.ts";
import TeamNotesPane from "./TeamNotesPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";
import type { AnnotationStore } from "./AnnotationStore.ts";
import type { TeamAnnotation } from "./types.ts";

export const VIEW_TYPE_TEAM_NOTES = "team-notes";

export class TeamNotesView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "message-square";
    title = "";
    navigation = true;
    private _store: AnnotationStore;
    private _currentUser: string;
    private _onOpenAnnotation: (annotation: TeamAnnotation) => void;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: ObsidianLiveSyncPlugin,
        store: AnnotationStore,
        currentUser: string,
        onOpenAnnotation: (annotation: TeamAnnotation) => void
    ) {
        super(leaf);
        this.plugin = plugin;
        this._store = store;
        this._currentUser = currentUser;
        this._onOpenAnnotation = onOpenAnnotation;
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamNotesPane, {
            target,
            props: {
                getMentions: () => this._store.getByMention(this._currentUser),
                getRecent: () => this._getRecentAnnotations(),
                onOpenAnnotation: this._onOpenAnnotation,
                onResolve: (id: string) => this._store.resolve(id),
            },
        });
    }

    private async _getRecentAnnotations(): Promise<TeamAnnotation[]> {
        // Get annotations on files the user has recently opened
        // For now, return all annotations sorted by time (can be refined later)
        const allMentions = await this._store.getByMention(this._currentUser);
        // Also get annotations authored by others on any file
        // We combine mentions with a broader query
        const result = await this._store.getByFile(""); // Will be empty — need allAnnotations
        // For simplicity: use allDocs approach — implemented via AnnotationStore.getAll()
        return allMentions;
    }

    getIcon(): string {
        return "message-square";
    }

    getViewType(): string {
        return VIEW_TYPE_TEAM_NOTES;
    }

    getDisplayText(): string {
        return "Team Notes";
    }
}
```

Note: The `_getRecentAnnotations` method is a placeholder. Task 8 (wiring) will provide the full implementation when integrating with the module's file tracking.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/modules/features/TeamSync/TeamNotesPane.svelte src/modules/features/TeamSync/TeamNotesView.ts
git commit -m "feat(team): add Team Notes sidebar view and component"
```

---

## Task 8: Wire Annotations into ModuleTeamSync

**Files:**
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts`

This is the integration task. It:
- Initializes `AnnotationStore` alongside the existing managers
- Registers the CM6 annotation extension via `registerEditorExtension()`
- Adds the `editor-menu` handler for "Add Team Note"
- Refreshes annotations when files open or annotation docs arrive
- Manages the annotation popover lifecycle
- Registers the Team Notes sidebar view
- Adds a command to show Team Notes

**Step 1: Add imports to ModuleTeamSync**

```typescript
import { AnnotationStore } from "./AnnotationStore.ts";
import { TextAnchor, type AnchorContext } from "./TextAnchor.ts";
import {
    createAnnotationExtension,
    setAnnotationsEffect,
    clearAnnotationsEffect,
    type EditorAnnotation,
} from "./AnnotationExtension.ts";
import { TeamNotesView, VIEW_TYPE_TEAM_NOTES } from "./TeamNotesView.ts";
import {
    EVENT_TEAM_ANNOTATION_CREATED,
    EVENT_TEAM_ANNOTATION_UPDATED,
    EVENT_TEAM_ANNOTATION_RESOLVED,
} from "./events.ts";
import type { EditorView } from "@codemirror/view";
```

**Step 2: Add annotation state to the class**

Add these fields to `ModuleTeamSync`:

```typescript
    annotationStore: AnnotationStore | undefined;
    private _annotationExtension: any[] | undefined;
```

**Step 3: Initialize annotation store in _onReady**

In `_onReady()`, after `this.changeTracker` initialization, add:

```typescript
            // Initialize annotation store
            this.annotationStore = new AnnotationStore(this.localDatabase);
```

**Step 4: Register CM6 extension and editor menu in _everyOnloadStart**

Add to `_everyOnloadStart()`:

```typescript
        // Register CM6 annotation extension
        this._annotationExtension = createAnnotationExtension();
        this.plugin.registerEditorExtension(this._annotationExtension);

        // Refresh annotations when a file opens
        this.plugin.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                if (file) {
                    void this._refreshEditorAnnotations(file.path);
                }
            })
        );

        // Editor context menu: "Add Team Note"
        this.plugin.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, info) => {
                if (!this.isTeamModeEnabled() || !this.annotationStore) return;
                const selection = editor.getSelection();
                if (!selection) return;

                menu.addItem((item) => {
                    item.setTitle("Add Team Note")
                        .setIcon("message-square")
                        .onClick(() => {
                            void this._createAnnotationFromSelection(editor, info);
                        });
                });
            })
        );

        // Register Team Notes sidebar view
        this.registerView(VIEW_TYPE_TEAM_NOTES, (leaf) => {
            if (!this.annotationStore) {
                throw new Error("Team Notes view requires annotation store initialization.");
            }
            return new TeamNotesView(
                leaf,
                this.plugin,
                this.annotationStore,
                this.getCurrentUsername(),
                (ann) => this._openAnnotationInFile(ann)
            );
        });

        this.addCommand({
            id: "show-team-notes",
            name: "Show Team Notes",
            callback: () => {
                void this.services.API.showWindow(VIEW_TYPE_TEAM_NOTES);
            },
        });
```

**Step 5: Add helper methods**

```typescript
    /**
     * Refresh CM6 decorations for the active editor.
     */
    private async _refreshEditorAnnotations(filePath: string): Promise<void> {
        if (!this.annotationStore) return;

        const annotations = await this.annotationStore.getByFile(filePath);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) return;

        const content = await this.app.vault.cachedRead(file as any);

        // Re-anchor each annotation and build editor annotations
        const editorAnnotations: EditorAnnotation[] = [];
        for (const ann of annotations) {
            if (ann.parentId) continue; // Skip replies

            const anchor: AnchorContext = {
                selectedText: "", // We need to store this — see note
                contextBefore: ann.contextBefore,
                contextAfter: ann.contextAfter,
                originalRange: ann.range,
            };

            // Try to find at original position first, then re-anchor
            const newRange = TextAnchor.findAnchor(content, anchor);
            const range = newRange ?? ann.range;

            // Count replies
            const replies = await this.annotationStore.getReplies(ann._id);

            editorAnnotations.push({
                id: ann._id,
                range,
                content: ann.content,
                author: ann.author,
                resolved: ann.resolved,
                replyCount: replies.length,
            });
        }

        // Dispatch effect to active editor
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf?.view && "editor" in leaf.view) {
            const editorView = (leaf.view as any).editor?.cm as EditorView | undefined;
            if (editorView) {
                editorView.dispatch({
                    effects: setAnnotationsEffect.of(editorAnnotations),
                });
            }
        }
    }

    /**
     * Create an annotation from the current editor selection.
     */
    private async _createAnnotationFromSelection(
        editor: any,
        info: any
    ): Promise<void> {
        if (!this.annotationStore) return;

        const filePath = info?.file?.path;
        if (!filePath) return;

        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        const range = {
            startLine: from.line,
            startChar: from.ch,
            endLine: to.line,
            endChar: to.ch,
        };

        // Capture context
        const content = await this.app.vault.cachedRead(info.file as any);
        const ctx = TextAnchor.captureContext(content, range);

        // Show popover for content input
        // For the initial implementation, use a simple prompt
        const noteContent = await this._promptForAnnotation();
        if (!noteContent) return;

        const mentions = (noteContent.match(/@(\w+)/g) ?? []).map((m: string) => m.slice(1));

        await this.annotationStore.create({
            filePath,
            range,
            contextBefore: ctx.contextBefore,
            contextAfter: ctx.contextAfter,
            content: noteContent,
            author: this.getCurrentUsername(),
            mentions,
            parentId: null,
        });

        eventHub.emitEvent(EVENT_TEAM_ANNOTATION_CREATED, undefined);
        void this._refreshEditorAnnotations(filePath);
    }

    private _promptForAnnotation(): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new (class extends (require("obsidian") as any).Modal {
                result: string | null = null;
                onOpen() {
                    const { contentEl } = this;
                    contentEl.createEl("h4", { text: "Add Team Note" });
                    const input = contentEl.createEl("textarea", {
                        attr: { placeholder: "Type your note... Use @username to mention", rows: "4", style: "width: 100%;" },
                    });
                    const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
                    btnContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
                        this.result = null;
                        this.close();
                    });
                    btnContainer.createEl("button", { text: "Add Note", cls: "mod-cta" }).addEventListener("click", () => {
                        this.result = input.value;
                        this.close();
                    });
                }
                onClose() {
                    resolve(this.result);
                }
            })(this.app);
            modal.open();
        });
    }

    /**
     * Open a file and scroll to an annotation's position.
     */
    private async _openAnnotationInFile(annotation: TeamAnnotation): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(annotation.filePath);
        if (!file) return;
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file as any);

        // Scroll to the annotation line
        const view = leaf.view;
        if (view && "editor" in view) {
            const editor = (view as any).editor;
            editor.setCursor({ line: annotation.range.startLine, ch: annotation.range.startChar });
            editor.scrollIntoView(
                { from: { line: annotation.range.startLine, ch: 0 }, to: { line: annotation.range.endLine, ch: 0 } },
                true
            );
        }
    }
```

**Step 6: Handle incoming annotation documents in _onDocumentArrived**

In `_onDocumentArrived`, add after the existing change tracking logic:

```typescript
        // Handle annotation documents
        const docId = (entry as any)._id as string | undefined;
        if (docId && docId.startsWith("team:annotation:")) {
            eventHub.emitEvent(EVENT_TEAM_ANNOTATION_UPDATED, undefined);
            // Refresh editor if this annotation is for the active file
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                void this._refreshEditorAnnotations(activeFile.path);
            }
        }
```

**Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 8: Run all tests for regressions**

Run: `npx vitest run test/unit/team-phase4.test.ts && npx vitest run test/unit/team-phase3.test.ts && npx vitest run test/unit/team-phase2.test.ts && npx vitest run test/unit/team.test.ts`
Expected: All tests pass

**Step 9: Commit**

```bash
git add src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): wire annotation system into ModuleTeamSync"
```

---

## Task 9: Update TeamAnnotation Type with Selected Text

**Files:**
- Modify: `src/modules/features/TeamSync/types.ts`

The `TextAnchor.findAnchor` method needs the original selected text for re-anchoring, but `TeamAnnotation` doesn't have a `selectedText` field. Add it.

**Step 1: Add selectedText field**

In `types.ts`, add `selectedText: string;` to the `TeamAnnotation` interface, after the `contextAfter` field.

**Step 2: Update AnnotationStore.create to include selectedText**

Update the `CreateAnnotationInput` type and `create` method to accept and store `selectedText`.

**Step 3: Update _createAnnotationFromSelection in ModuleTeamSync**

Pass `ctx.selectedText` when creating annotations.

**Step 4: Update _refreshEditorAnnotations in ModuleTeamSync**

Use `ann.selectedText` in the `AnchorContext` for re-anchoring.

**Step 5: Verify build and tests**

Run: `npm run build && npx vitest run test/unit/team-phase4.test.ts`
Expected: Build succeeds, tests pass

**Step 6: Commit**

```bash
git add src/modules/features/TeamSync/types.ts src/modules/features/TeamSync/AnnotationStore.ts src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): add selectedText to TeamAnnotation for re-anchoring"
```

---

## Task 10: Integration Tests and Final Verification

**Files:**
- Modify: `test/unit/team-phase4.test.ts` (append integration tests)

**Step 1: Add integration tests**

Append to `test/unit/team-phase4.test.ts`:

```typescript
describe("Phase 4 Integration", () => {
    it("should export AnnotationStore with all methods", async () => {
        const { AnnotationStore } = await import(
            "../../src/modules/features/TeamSync/AnnotationStore"
        );
        const methods = ["create", "getById", "getByFile", "getByMention", "getReplies", "update", "resolve"];
        for (const m of methods) {
            expect(typeof AnnotationStore.prototype[m]).toBe("function");
        }
    });

    it("should export TextAnchor with all methods", async () => {
        const { TextAnchor } = await import(
            "../../src/modules/features/TeamSync/TextAnchor"
        );
        expect(typeof TextAnchor.captureContext).toBe("function");
        expect(typeof TextAnchor.findAnchor).toBe("function");
    });

    it("should export CM6 extension factory", async () => {
        const { createAnnotationExtension, setAnnotationsEffect, clearAnnotationsEffect } = await import(
            "../../src/modules/features/TeamSync/AnnotationExtension"
        );
        expect(typeof createAnnotationExtension).toBe("function");
        expect(setAnnotationsEffect).toBeDefined();
        expect(clearAnnotationsEffect).toBeDefined();
    });

    it("should export Team Notes view constants", async () => {
        const { VIEW_TYPE_TEAM_NOTES } = await import(
            "../../src/modules/features/TeamSync/TeamNotesView"
        );
        expect(VIEW_TYPE_TEAM_NOTES).toBe("team-notes");
    });

    it("should compute context and re-anchor correctly end-to-end", () => {
        const original = "The quick brown fox jumps over the lazy dog";
        const range = { startLine: 0, startChar: 10, endLine: 0, endChar: 19 };
        const ctx = TextAnchor.captureContext(original, range);
        expect(ctx.selectedText).toBe("brown fox");

        // Text shifts — add prefix
        const modified = "PREFIX The quick brown fox jumps over the lazy dog";
        const newRange = TextAnchor.findAnchor(modified, {
            ...ctx,
            originalRange: range,
        });
        expect(newRange).not.toBeNull();
        // Should find "brown fox" at the new offset
        const lines = modified.split("\n");
        const offset = TextAnchor._toOffset(lines, newRange!.startLine, newRange!.startChar);
        expect(modified.slice(offset, offset + 9)).toBe("brown fox");
    });
});
```

**Step 2: Run all Phase 4 tests**

Run: `npx vitest run test/unit/team-phase4.test.ts`
Expected: All tests pass

**Step 3: Run all previous phase tests**

Run: `npx vitest run test/unit/team-phase3.test.ts && npx vitest run test/unit/team-phase2.test.ts && npx vitest run test/unit/team.test.ts`
Expected: All tests pass

**Step 4: Build verification**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add test/unit/team-phase4.test.ts
git commit -m "test(team): add Phase 4 integration tests"
```
