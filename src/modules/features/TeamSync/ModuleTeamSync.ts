import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractObsidianModule } from "../../AbstractObsidianModule.ts";
import type { LiveSyncCore } from "../../../main.ts";
import type { TeamConfig } from "./types.ts";
import { TEAM_CONFIG_ID } from "./types.ts";

export class ModuleTeamSync extends AbstractObsidianModule {
    private _teamConfig: TeamConfig | undefined;

    /**
     * Whether team mode is currently enabled.
     * Team mode is enabled when a team:config document exists in the database.
     */
    isTeamModeEnabled(): boolean {
        return this._teamConfig !== undefined;
    }

    /**
     * Get the current user's CouchDB username.
     */
    getCurrentUsername(): string {
        return this.settings.couchDB_USER;
    }

    /**
     * Get the current user's team role, or undefined if not in a team.
     */
    getCurrentUserRole(): string | undefined {
        if (!this._teamConfig) return undefined;
        const username = this.getCurrentUsername();
        return this._teamConfig.members[username]?.role;
    }

    /**
     * Check if the current user is a team admin.
     */
    isCurrentUserAdmin(): boolean {
        return this.getCurrentUserRole() === "admin";
    }

    /**
     * Get the team config. Returns undefined if team mode is not enabled.
     */
    getTeamConfig(): TeamConfig | undefined {
        return this._teamConfig;
    }

    private async _loadTeamConfig(): Promise<void> {
        try {
            const doc = await this.localDatabase.localDatabase.get(TEAM_CONFIG_ID);
            if (doc && !(doc as any)._deleted) {
                this._teamConfig = doc as unknown as TeamConfig;
                this._log("Team mode enabled: " + this._teamConfig.teamName, LOG_LEVEL_INFO);
            } else {
                this._teamConfig = undefined;
                this._log("Team mode not configured", LOG_LEVEL_VERBOSE);
            }
        } catch {
            this._teamConfig = undefined;
            this._log("Team config not found — team mode disabled", LOG_LEVEL_VERBOSE);
        }
    }

    private async _onReady(): Promise<boolean> {
        if (this.isDatabaseReady()) {
            await this._loadTeamConfig();
        }
        return true;
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onSettingLoaded.addHandler(this._onReady.bind(this));
    }
}
