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
            selectedText: "test text",
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
            contextBefore: "", contextAfter: "", selectedText: "",
            content: "test", author: "alice", mentions: [], parentId: null,
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
            contextBefore: "", contextAfter: "", selectedText: "",
            content: "note on a", author: "alice", mentions: [], parentId: null,
        });
        await store.create({
            filePath: "notes/b.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "", selectedText: "",
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
            contextBefore: "", contextAfter: "", selectedText: "",
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
            contextBefore: "", contextAfter: "", selectedText: "",
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
            contextBefore: "", contextAfter: "", selectedText: "",
            content: "hey @bob", author: "alice", mentions: ["bob"], parentId: null,
        });
        await store.create({
            filePath: "notes/b.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "", selectedText: "",
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
            contextBefore: "", contextAfter: "", selectedText: "",
            content: "parent", author: "alice", mentions: [], parentId: null,
        });
        await store.create({
            filePath: "notes/a.md",
            range: { startLine: 1, startChar: 0, endLine: 1, endChar: 5 },
            contextBefore: "", contextAfter: "", selectedText: "",
            content: "reply", author: "bob", mentions: [], parentId: parent._id,
        });
        const replies = await store.getReplies(parent._id);
        expect(replies.length).toBe(1);
        expect(replies[0].content).toBe("reply");
    });
});

import { TextAnchor } from "../../src/modules/features/TeamSync/TextAnchor";

describe("TextAnchor", () => {
    describe("captureContext", () => {
        it("should capture surrounding context from document text", () => {
            const text = "Line one\nLine two has some content here\nLine three";
            const ctx = TextAnchor.captureContext(text, { startLine: 1, startChar: 13, endLine: 1, endChar: 25 });
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
                originalRange: { startLine: 1, startChar: 13, endLine: 1, endChar: 25 },
            });
            expect(result).not.toBeNull();
            expect(result!.startLine).toBe(1);
            expect(result!.startChar).toBe(13);
        });

        it("should find text after lines were inserted above", () => {
            const modified = "AAA\nNew line\nBBB target text CCC\nDDD";
            const result = TextAnchor.findAnchor(modified, {
                selectedText: "target text",
                contextBefore: "BBB ",
                contextAfter: " CCC",
                originalRange: { startLine: 1, startChar: 4, endLine: 1, endChar: 15 },
            });
            expect(result).not.toBeNull();
            expect(result!.startLine).toBe(2);
        });

        it("should find text with partial context match", () => {
            const text = "Some prefix changed target text suffix changed end";
            const result = TextAnchor.findAnchor(text, {
                selectedText: "target text",
                contextBefore: "original prefix ",
                contextAfter: " original suffix",
                originalRange: { startLine: 0, startChar: 0, endLine: 0, endChar: 11 },
            });
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

        const modified = "PREFIX The quick brown fox jumps over the lazy dog";
        const newRange = TextAnchor.findAnchor(modified, {
            ...ctx,
            originalRange: range,
        });
        expect(newRange).not.toBeNull();
        const lines = modified.split("\n");
        const offset = TextAnchor._toOffset(lines, newRange!.startLine, newRange!.startChar);
        expect(modified.slice(offset, offset + 9)).toBe("brown fox");
    });
});
