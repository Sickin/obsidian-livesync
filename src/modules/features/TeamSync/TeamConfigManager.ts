import type { LiveSyncLocalDB } from "../../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { type TeamConfig, type TeamRole, TEAM_CONFIG_ID, createDefaultTeamConfig } from "./types.ts";

/**
 * Manages the team:config document in the local PouchDB database.
 * The document syncs to CouchDB via normal LiveSync replication.
 */
export class TeamConfigManager {
    constructor(private db: LiveSyncLocalDB) {}

    /**
     * Get the current team config, or null if none exists.
     */
    async getConfig(): Promise<TeamConfig | null> {
        try {
            const doc = await this.db.localDatabase.get(TEAM_CONFIG_ID);
            if (doc && !(doc as any)._deleted) {
                return doc as unknown as TeamConfig;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Save a team config document (create or update).
     */
    async saveConfig(config: TeamConfig): Promise<boolean> {
        try {
            // Fetch current rev if updating
            const existing = await this.getConfig();
            if (existing?._rev) {
                config._rev = existing._rev;
            }
            await this.db.localDatabase.put(config as any);
            return true;
        } catch (e) {
            console.error("Failed to save team config:", e);
            return false;
        }
    }

    /**
     * Initialize team mode: creates the team:config document.
     */
    async initializeTeam(teamName: string, adminUsername: string): Promise<boolean> {
        const existing = await this.getConfig();
        if (existing) {
            return false; // Already initialized
        }
        const config = createDefaultTeamConfig(teamName, adminUsername);
        return this.saveConfig(config);
    }

    /**
     * Add a member to the team.
     */
    async addMember(username: string, role: TeamRole): Promise<boolean> {
        const config = await this.getConfig();
        if (!config) return false;
        config.members[username] = { role };
        return this.saveConfig(config);
    }

    /**
     * Update a member's role.
     */
    async updateMemberRole(username: string, role: TeamRole): Promise<boolean> {
        const config = await this.getConfig();
        if (!config || !config.members[username]) return false;
        config.members[username].role = role;
        return this.saveConfig(config);
    }

    /**
     * Remove a member from the team.
     */
    async removeMember(username: string): Promise<boolean> {
        const config = await this.getConfig();
        if (!config || !config.members[username]) return false;
        delete config.members[username];
        return this.saveConfig(config);
    }

    /**
     * Get all members and their roles.
     */
    async getMembers(): Promise<Record<string, { role: TeamRole }>> {
        const config = await this.getConfig();
        if (!config) return {};
        return config.members;
    }
}
