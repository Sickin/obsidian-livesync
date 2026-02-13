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
