import type { LiveSyncLocalDB } from "../../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import type { TeamNotificationConfig, UserNotificationPrefs } from "./types.ts";

export class NotificationStore {
    constructor(private db: LiveSyncLocalDB) {}

    async getConfig(): Promise<TeamNotificationConfig | null> {
        try {
            const doc = await this.db.localDatabase.get("team:notifications:config");
            if ((doc as any)._deleted) return null;
            return doc as unknown as TeamNotificationConfig;
        } catch {
            return null;
        }
    }

    async saveConfig(config: TeamNotificationConfig): Promise<void> {
        if (!config._rev) {
            try {
                const existing = await this.db.localDatabase.get(config._id);
                config._rev = (existing as any)._rev;
            } catch { /* New document */ }
        }
        await this.db.localDatabase.put(config as any);
    }

    async getPrefs(username: string): Promise<UserNotificationPrefs | null> {
        try {
            const doc = await this.db.localDatabase.get(`team:notifications:prefs:${username}`);
            if ((doc as any)._deleted) return null;
            return doc as unknown as UserNotificationPrefs;
        } catch {
            return null;
        }
    }

    async savePrefs(prefs: UserNotificationPrefs): Promise<void> {
        if (!prefs._rev) {
            try {
                const existing = await this.db.localDatabase.get(prefs._id);
                prefs._rev = (existing as any)._rev;
            } catch { /* New document */ }
        }
        await this.db.localDatabase.put(prefs as any);
    }

    async getAllPrefs(): Promise<UserNotificationPrefs[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:notifications:prefs:",
            endkey: "team:notifications:prefs:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as UserNotificationPrefs)
            .filter((p) => p && !(p as any)._deleted);
    }
}
