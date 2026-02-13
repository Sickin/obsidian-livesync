import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";

interface OverrideRecord {
    overridden: string[];
}

/**
 * Tracks which team-default settings a member has intentionally customized.
 * Uses local SimpleStore (IndexedDB) — not synced to CouchDB.
 * Follows the ReadStateManager pattern.
 */
export class TeamOverrideTracker {
    constructor(private store: SimpleStore<OverrideRecord>) {}

    async isOverridden(pluginId: string, settingKey: string): Promise<boolean> {
        const record = await this.store.get(pluginId);
        if (!record) return false;
        return record.overridden.includes(settingKey);
    }

    async markOverridden(pluginId: string, settingKey: string): Promise<void> {
        const record = (await this.store.get(pluginId)) ?? { overridden: [] };
        if (!record.overridden.includes(settingKey)) {
            record.overridden.push(settingKey);
            await this.store.set(pluginId, record);
        }
    }

    async clearOverride(pluginId: string, settingKey: string): Promise<void> {
        const record = await this.store.get(pluginId);
        if (!record) return;
        record.overridden = record.overridden.filter((k) => k !== settingKey);
        await this.store.set(pluginId, record);
    }

    async getOverrides(pluginId: string): Promise<string[]> {
        const record = await this.store.get(pluginId);
        return record?.overridden ?? [];
    }

    async clearAllOverrides(pluginId: string): Promise<void> {
        await this.store.set(pluginId, { overridden: [] });
    }
}
