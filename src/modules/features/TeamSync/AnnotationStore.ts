import type { LiveSyncLocalDB } from "../../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import type { TeamAnnotation } from "./types.ts";

type CreateAnnotationInput = Omit<TeamAnnotation, "_id" | "_rev" | "timestamp" | "resolved">;

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
            selectedText: input.selectedText,
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
            .filter((a) => a && !(a as any)._deleted && a.filePath === filePath);
    }

    async getByMention(username: string): Promise<TeamAnnotation[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:annotation:",
            endkey: "team:annotation:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as TeamAnnotation)
            .filter((a) => a && !(a as any)._deleted && a.mentions.includes(username));
    }

    async getReplies(parentId: string): Promise<TeamAnnotation[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:annotation:",
            endkey: "team:annotation:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as TeamAnnotation)
            .filter((a) => a && !(a as any)._deleted && a.parentId === parentId);
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
