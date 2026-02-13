import { WorkspaceLeaf } from "@/deps.ts";
import TeamNotesPane from "./TeamNotesPane.svelte";
import type ObsidianLiveSyncPlugin from "../../../main.ts";
import { SvelteItemView } from "../../../common/SvelteItemView.ts";
import { mount } from "svelte";
import type { AnnotationStore } from "./AnnotationStore.ts";
import type { TeamAnnotation } from "./types.ts";

export const VIEW_TYPE_TEAM_NOTES = "team-notes";

export class TeamNotesView extends SvelteItemView {
    plugin: ObsidianLiveSyncPlugin;
    icon = "message-square";
    title = "";
    navigation = true;
    private _store: AnnotationStore;
    private _currentUser: string;
    private _onOpenAnnotation: (annotation: TeamAnnotation) => void;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: ObsidianLiveSyncPlugin,
        store: AnnotationStore,
        currentUser: string,
        onOpenAnnotation: (annotation: TeamAnnotation) => void
    ) {
        super(leaf);
        this.plugin = plugin;
        this._store = store;
        this._currentUser = currentUser;
        this._onOpenAnnotation = onOpenAnnotation;
    }

    instantiateComponent(target: HTMLElement) {
        return mount(TeamNotesPane, {
            target,
            props: {
                getMentions: () => this._store.getByMention(this._currentUser),
                getRecent: () => this._store.getByMention(this._currentUser),
                onOpenAnnotation: this._onOpenAnnotation,
                onResolve: (id: string) => this._store.resolve(id),
            },
        });
    }

    getIcon(): string {
        return "message-square";
    }

    getViewType(): string {
        return VIEW_TYPE_TEAM_NOTES;
    }

    getDisplayText(): string {
        return "Team Notes";
    }
}
