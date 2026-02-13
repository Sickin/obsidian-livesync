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

describe("TeamOverrideTracker", () => {
    let tracker: any;

    beforeEach(async () => {
        const { TeamOverrideTracker } = await import(
            "../../src/modules/features/TeamSync/TeamOverrideTracker"
        );
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
        expect(result.applied.syncOnStart).toBe(false);
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
        expect(result.applied.liveSync).toBe(true);
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

        const memberSettings = { liveSync: false, syncOnStart: false, batchSave: true, deviceName: "laptop" };

        // First apply
        const entry = await settingsStore.getEntry("self-hosted-livesync");
        const result1 = await applier.apply(entry!, memberSettings);
        expect(result1.applied.liveSync).toBe(true);
        expect(result1.applied.syncOnStart).toBe(true);
        expect(result1.applied.batchSave).toBe(false);
        expect(result1.applied.deviceName).toBe("laptop");

        // Member customizes syncOnStart
        await applier.detectCustomization(entry!, "syncOnStart", false);
        expect(await overrideTracker.isOverridden("self-hosted-livesync", "syncOnStart")).toBe(true);

        // Re-apply — member's override preserved
        const result2 = await applier.apply(entry!, { ...memberSettings, syncOnStart: false });
        expect(result2.applied.syncOnStart).toBe(false);
        expect(result2.applied.liveSync).toBe(true);
        expect(result2.applied.batchSave).toBe(false);
    });
});
