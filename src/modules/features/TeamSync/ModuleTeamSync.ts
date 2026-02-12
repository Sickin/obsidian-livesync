import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractObsidianModule } from "../../AbstractObsidianModule.ts";
import type { LiveSyncCore } from "../../../main.ts";
import type { TeamConfig, TeamRole } from "./types.ts";
import { TeamConfigManager } from "./TeamConfigManager.ts";
import { CouchDBUserManager } from "./CouchDBUserManager.ts";
import { TeamValidation } from "./ValidationFunction.ts";

export class ModuleTeamSync extends AbstractObsidianModule {
    private _teamConfig: TeamConfig | undefined;
    configManager!: TeamConfigManager;

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
        this.configManager = new TeamConfigManager(this.localDatabase);
        try {
            this._teamConfig = await this.configManager.getConfig() ?? undefined;
            if (this._teamConfig) {
                this._log("Team mode enabled: " + this._teamConfig.teamName, LOG_LEVEL_INFO);
            } else {
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

    private _userManager: CouchDBUserManager | undefined;

    private _getUserManager(): CouchDBUserManager {
        if (!this._userManager) {
            this._userManager = new CouchDBUserManager(
                this.settings.couchDB_URI,
                {
                    username: this.settings.couchDB_USER,
                    password: this.settings.couchDB_PASSWORD,
                }
            );
        }
        return this._userManager;
    }

    /**
     * Initialize team mode: creates config doc, validation function, and registers admin.
     */
    async initializeTeam(teamName: string): Promise<boolean> {
        const username = this.getCurrentUsername();
        if (!username) return false;

        const success = await this.configManager.initializeTeam(teamName, username);
        if (!success) return false;

        const authHeader = `Basic ${btoa(`${this.settings.couchDB_USER}:${this.settings.couchDB_PASSWORD}`)}`;
        await TeamValidation.install(
            this.settings.couchDB_URI,
            this.settings.couchDB_DBNAME,
            authHeader
        );

        await this._loadTeamConfig();
        return true;
    }

    /**
     * Invite a new team member: creates CouchDB user and adds to team config.
     */
    async inviteMember(username: string, password: string, role: TeamRole): Promise<boolean> {
        const userManager = this._getUserManager();
        const created = await userManager.createUser(username, password, role);
        if (!created) return false;
        return this.configManager.addMember(username, role);
    }

    /**
     * Change a member's role in both CouchDB and team config.
     */
    async changeMemberRole(username: string, role: TeamRole): Promise<boolean> {
        const userManager = this._getUserManager();
        const updated = await userManager.updateUserRole(username, role);
        if (!updated) return false;
        return this.configManager.updateMemberRole(username, role);
    }

    /**
     * Remove a member from the team and CouchDB.
     */
    async removeMember(username: string): Promise<boolean> {
        const userManager = this._getUserManager();
        await userManager.deleteUser(username);
        return this.configManager.removeMember(username);
    }

    /**
     * Reset a member's password.
     */
    async resetMemberPassword(username: string, newPassword: string): Promise<boolean> {
        const userManager = this._getUserManager();
        return await userManager.resetPassword(username, newPassword);
    }

    /**
     * Called by the settings dialogue to render the team management pane.
     * Returns a cleanup function.
     */
    renderTeamPane(containerEl: HTMLElement): () => void {
        void import("./TeamManagementPane.svelte").then(async ({ default: TeamManagementPane }) => {
            const { mount, unmount } = await import("svelte");
            const { writable } = await import("svelte/store");

            const port = writable({
                teamConfig: this._teamConfig ?? null,
                currentUsername: this.getCurrentUsername(),
                isAdmin: this.isCurrentUserAdmin(),
                onInitializeTeam: async (teamName: string) => {
                    await this.initializeTeam(teamName);
                    port.update((p) => p ? { ...p, teamConfig: this._teamConfig ?? null } : p);
                },
                onInviteMember: async (username: string, password: string, role: TeamRole) => {
                    await this.inviteMember(username, password, role);
                    await this._loadTeamConfig();
                    port.update((p) => p ? { ...p, teamConfig: this._teamConfig ?? null } : p);
                },
                onChangeMemberRole: async (username: string, role: TeamRole) => {
                    await this.changeMemberRole(username, role);
                    await this._loadTeamConfig();
                    port.update((p) => p ? { ...p, teamConfig: this._teamConfig ?? null } : p);
                },
                onRemoveMember: async (username: string) => {
                    await this.removeMember(username);
                    await this._loadTeamConfig();
                    port.update((p) => p ? { ...p, teamConfig: this._teamConfig ?? null } : p);
                },
                onResetPassword: async (username: string, password: string) => {
                    await this.resetMemberPassword(username, password);
                },
            });

            const component = mount(TeamManagementPane, {
                target: containerEl,
                props: { port },
            });

            (containerEl as any).__teamPaneCleanup = () => unmount(component);
        });

        return () => {
            if ((containerEl as any).__teamPaneCleanup) {
                (containerEl as any).__teamPaneCleanup();
            }
        };
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onSettingLoaded.addHandler(this._onReady.bind(this));
    }
}
