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
        if (!entry._rev) {
            try {
                const existing = await this.db.localDatabase.get(entry._id);
                entry._rev = (existing as any)._rev;
            } catch {
                // New document
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
