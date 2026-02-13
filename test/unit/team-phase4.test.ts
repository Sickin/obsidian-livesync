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
            contextBefore: "", contextAfter: "",
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
