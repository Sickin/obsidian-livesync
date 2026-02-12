import { WorkspaceLeaf } from "@/deps.ts";
import TeamActivityPane from "./TeamActivityPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";
import type { ChangeTracker } from "./ChangeTracker.ts";

export const VIEW_TYPE_TEAM_ACTIVITY = "team-activity";

export class TeamActivityView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "users";
    title = "";
    navigation = true;
    private _tracker: ChangeTracker;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin, tracker: ChangeTracker) {
        super(leaf);
        this.plugin = plugin;
        this._tracker = tracker;
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamActivityPane, {
            target,
            props: {
                getActivityFeed: () => this._tracker.getActivityFeed(),
                getUnreadFiles: () => this._tracker.getUnreadFiles(),
                onOpenFile: (filePath: string) => {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file) {
                        void this.app.workspace.getLeaf(false).openFile(file as any);
                    }
                },
            },
        });
    }

    getIcon(): string {
        return "users";
    }

    getViewType(): string {
        return VIEW_TYPE_TEAM_ACTIVITY;
    }

    getDisplayText(): string {
        return "Team Activity";
    }
}
