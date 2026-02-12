import { WorkspaceLeaf } from "@/deps.ts";
import TeamActivityPane from "./TeamActivityPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";
import type { ChangeTracker } from "./ChangeTracker.ts";
import { getDocData } from "../../../lib/src/common/utils.ts";

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

    private async _loadInlineDiff(
        filePath: string,
        rev: string
    ): Promise<{ html: string; summary: string } | null> {
        const db = this.plugin.localDatabase;
        try {
            const entry = await db.getDBEntry(
                filePath as any,
                { rev },
                false,
                false,
                true
            );
            if (entry === false) return null;

            const newContent = typeof entry.data === "string"
                ? entry.data
                : getDocData(entry.data);

            // Get previous revision
            const id = await this.plugin.services.path.path2id(filePath);
            const rawDoc = await db.getRaw(id, { revs_info: true });
            const revs = (rawDoc._revs_info ?? []).filter(
                (r: any) => r.status === "available"
            );
            const revIndex = revs.findIndex((r: any) => r.rev === rev);

            let oldContent = "";
            if (revIndex >= 0 && revIndex + 1 < revs.length) {
                const prevRev = revs[revIndex + 1].rev;
                const prevEntry = await db.getDBEntry(
                    filePath as any,
                    { rev: prevRev },
                    false,
                    false,
                    true
                );
                if (prevEntry !== false) {
                    oldContent = typeof prevEntry.data === "string"
                        ? prevEntry.data
                        : getDocData(prevEntry.data);
                }
            }

            const { TeamDiffService } = await import("./TeamDiffService.ts");
            const diff = TeamDiffService.computeDiff(oldContent, newContent);
            const html = TeamDiffService.renderDiffToHtml(diff);
            const summaryData = TeamDiffService.computeDiffSummary(diff);
            return {
                html,
                summary: `+${summaryData.added} / -${summaryData.removed}`,
            };
        } catch {
            return null;
        }
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamActivityPane, {
            target,
            props: {
                getActivityFeed: () => this._tracker.getActivityFeed(),
                getUnreadFiles: () => this._tracker.getUnreadFiles(),
                getAuthors: () => this._tracker.getAuthors(),
                onOpenFile: (filePath: string) => {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file) {
                        void this.app.workspace.getLeaf(false).openFile(file as any);
                    }
                },
                onLoadDiff: async (filePath: string, rev: string) => {
                    return await this._loadInlineDiff(filePath, rev);
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
