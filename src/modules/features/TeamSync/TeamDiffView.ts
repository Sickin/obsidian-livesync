import { WorkspaceLeaf } from "@/deps.ts";
import TeamDiffPane from "./TeamDiffPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";

export const VIEW_TYPE_TEAM_DIFF = "team-diff";

export interface TeamDiffViewState {
    filePath: string;
    oldContent: string;
    newContent: string;
    oldRev: string;
    newRev: string;
    authors: string[];
    oldMtime: number;
    newMtime: number;
}

export class TeamDiffView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "file-diff";
    title = "";
    navigation = true;
    private _state: TeamDiffViewState;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianLiveSyncPlugin, state: TeamDiffViewState) {
        super(leaf);
        this.plugin = plugin;
        this._state = state;
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamDiffPane, {
            target,
            props: {
                filePath: this._state.filePath,
                oldContent: this._state.oldContent,
                newContent: this._state.newContent,
                oldRev: this._state.oldRev,
                newRev: this._state.newRev,
                authors: this._state.authors,
                oldMtime: this._state.oldMtime,
                newMtime: this._state.newMtime,
            },
        });
    }

    getIcon(): string {
        return "file-diff";
    }

    getViewType(): string {
        return VIEW_TYPE_TEAM_DIFF;
    }

    getDisplayText(): string {
        const name = this._state.filePath.split("/").pop() ?? "Diff";
        return `Team Changes: ${name}`;
    }
}
