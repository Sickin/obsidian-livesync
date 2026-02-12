import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractObsidianModule } from "../../AbstractObsidianModule.ts";
import type { LiveSyncCore } from "../../../main.ts";
import type { TeamConfig, TeamRole } from "./types.ts";
import type { MetaEntry, FilePathWithPrefix } from "../../../lib/src/common/types.ts";
import { getPath } from "../../../common/utils.ts";
import { TeamConfigManager } from "./TeamConfigManager.ts";
import { CouchDBUserManager } from "./CouchDBUserManager.ts";
import { TeamValidation } from "./ValidationFunction.ts";
import { ReadStateManager } from "./ReadStateManager.ts";
import { ChangeTracker } from "./ChangeTracker.ts";
import { EVENT_TEAM_FILE_CHANGED, EVENT_TEAM_FILE_READ, EVENT_TEAM_ACTIVITY_UPDATED } from "./events.ts";
import { eventHub } from "../../../common/events.ts";
import { TeamFileDecorator } from "./TeamFileDecorator.ts";
import { TeamActivityView, VIEW_TYPE_TEAM_ACTIVITY } from "./TeamActivityView.ts";
import { TeamDiffView, VIEW_TYPE_TEAM_DIFF, type TeamDiffViewState } from "./TeamDiffView.ts";
import { getDocData } from "../../../lib/src/common/utils.ts";

export class ModuleTeamSync extends AbstractObsidianModule {
    private _teamConfig: TeamConfig | undefined;
    configManager!: TeamConfigManager;
    readStateManager: ReadStateManager | undefined;
    changeTracker: ChangeTracker | undefined;
    private _fileDecorator: TeamFileDecorator | undefined;

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

            // Initialize read state manager
            const store = this.services.database.openSimpleStore<any>("team-readstate");
            this.readStateManager = new ReadStateManager(store);

            // Initialize change tracker
            this.changeTracker = new ChangeTracker(this.getCurrentUsername());
        }
        return true;
    }

    /**
     * Called when a document arrives from remote replication.
     * Checks modifiedBy and updates change tracker if from another user.
     */
    private async _onDocumentArrived(entry: MetaEntry): Promise<boolean> {
        if (!this.isTeamModeEnabled() || !this.changeTracker) return true;

        const modifiedBy = (entry as any).modifiedBy as string | undefined;
        if (!modifiedBy) return true;

        const filePath = getPath(entry);
        const rev = entry._rev ?? "";
        const timestamp = entry.mtime ?? Date.now();

        this.changeTracker.trackChange(filePath, modifiedBy, timestamp, rev);

        if (modifiedBy !== this.getCurrentUsername()) {
            eventHub.emitEvent(EVENT_TEAM_FILE_CHANGED, filePath as FilePathWithPrefix);
        }

        eventHub.emitEvent(EVENT_TEAM_ACTIVITY_UPDATED, undefined);
        return true;
    }

    /**
     * Open a team diff view for a file.
     * Shows diff between last-seen revision and current revision.
     */
    async openTeamDiff(filePath: string): Promise<void> {
        const pathWithPrefix = filePath as FilePathWithPrefix;

        // Get current entry
        const currentEntry = await this.core.databaseFileAccess.fetchEntry(pathWithPrefix, undefined, true, true);
        if (currentEntry === false) {
            this._log("Cannot load current revision for diff", LOG_LEVEL_INFO);
            return;
        }

        const currentRev = currentEntry._rev ?? "";
        const currentContent = typeof currentEntry.data === "string"
            ? currentEntry.data
            : getDocData(currentEntry.data);
        const currentMtime = currentEntry.mtime;

        // Get last-seen revision from read state
        let oldContent = "";
        let oldRev = "";
        let oldMtime = 0;
        const readState = await this.readStateManager?.getReadState(filePath);

        if (readState && readState.lastSeenRev !== currentRev) {
            try {
                const oldEntry = await this.core.databaseFileAccess.fetchEntry(
                    pathWithPrefix, readState.lastSeenRev, true, true
                );
                if (oldEntry !== false) {
                    oldRev = readState.lastSeenRev;
                    oldContent = typeof oldEntry.data === "string"
                        ? oldEntry.data
                        : getDocData(oldEntry.data);
                    oldMtime = oldEntry.mtime;
                }
            } catch {
                // Old revision may have been compacted — fall back to empty
            }
        }

        // Collect authors from activity feed
        const authors: string[] = [];
        if (this.changeTracker) {
            const feed = this.changeTracker.getActivityFeed();
            for (const entry of feed) {
                if (entry.filePath === filePath && !authors.includes(entry.modifiedBy)) {
                    authors.push(entry.modifiedBy);
                }
            }
        }
        if (authors.length === 0) authors.push("Unknown");

        // Open in a new leaf
        const state: TeamDiffViewState = {
            filePath,
            oldContent,
            newContent: currentContent,
            oldRev: oldRev || "(initial)",
            newRev: currentRev,
            authors,
            oldMtime,
            newMtime: currentMtime,
        };

        const leaf = this.app.workspace.getLeaf("tab");
        const view = new TeamDiffView(leaf, this.plugin, state);
        await leaf.open(view);
    }

    private _everyOnloadStart(): Promise<boolean> {
        // Listen for file opens to clear unread state
        this.plugin.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                if (!file || !this.changeTracker || !this.readStateManager) return;
                const filePath = file.path;
                this.changeTracker.markAsRead(filePath);
                eventHub.emitEvent(EVENT_TEAM_FILE_READ, filePath as FilePathWithPrefix);
            })
        );

        // Set up file decorator once layout is ready
        this.app.workspace.onLayoutReady(() => {
            if (this.changeTracker) {
                this._fileDecorator = new TeamFileDecorator(
                    this.changeTracker,
                    document.body
                );
            }
        });

        this.plugin.register(() => {
            this._fileDecorator?.destroy();
            this._fileDecorator = undefined;
        });

        // Register team activity sidebar view
        this.registerView(VIEW_TYPE_TEAM_ACTIVITY, (leaf) => {
            if (!this.changeTracker) {
                throw new Error("Team Activity view requires change tracker initialization.");
            }
            return new TeamActivityView(leaf, this.plugin, this.changeTracker);
        });

        this.addCommand({
            id: "show-team-activity",
            name: "Show Team Activity",
            callback: () => {
                void this.services.API.showWindow(VIEW_TYPE_TEAM_ACTIVITY);
            },
        });

        // Register team diff view
        this.registerView(VIEW_TYPE_TEAM_DIFF, (leaf) => {
            return new TeamDiffView(leaf, this.plugin, {
                filePath: "",
                oldContent: "",
                newContent: "",
                oldRev: "",
                newRev: "",
                authors: [],
                oldMtime: 0,
                newMtime: 0,
            });
        });

        // Add "View Team Changes" to file context menu
        this.plugin.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!this.isTeamModeEnabled() || !this.changeTracker) return;
                if (!this.changeTracker.isUnread(file.path)) return;
                menu.addItem((item) => {
                    item.setTitle("View Team Changes")
                        .setIcon("file-diff")
                        .onClick(() => {
                            void this.openTeamDiff(file.path);
                        });
                });
            })
        );

        return Promise.resolve(true);
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
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._onReady.bind(this));
        services.replication.processSynchroniseResult.addHandler(this._onDocumentArrived.bind(this));
    }
}
