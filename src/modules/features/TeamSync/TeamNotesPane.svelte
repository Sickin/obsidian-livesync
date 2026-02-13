<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { TeamAnnotation } from "./types";
    import { eventHub } from "../../../common/events";
    import {
        EVENT_TEAM_ANNOTATION_CREATED,
        EVENT_TEAM_ANNOTATION_UPDATED,
        EVENT_TEAM_ANNOTATION_RESOLVED,
    } from "./events";

    type Props = {
        getMentions: () => Promise<TeamAnnotation[]>;
        getRecent: () => Promise<TeamAnnotation[]>;
        onOpenAnnotation: (annotation: TeamAnnotation) => void;
        onResolve: (annotationId: string) => Promise<void>;
    };

    const { getMentions, getRecent, onOpenAnnotation, onResolve }: Props = $props();

    let activeTab = $state<"mentions" | "recent">("mentions");
    let annotations = $state<TeamAnnotation[]>([]);
    let showResolved = $state(false);
    let disposers: (() => void)[] = [];

    const filteredAnnotations = $derived.by(() => {
        if (showResolved) return annotations;
        return annotations.filter((a) => !a.resolved);
    });

    const unreadCount = $derived(annotations.filter((a) => !a.resolved).length);

    async function refresh() {
        if (activeTab === "mentions") {
            annotations = await getMentions();
        } else {
            annotations = await getRecent();
        }
    }

    function handleTabChange(tab: "mentions" | "recent") {
        activeTab = tab;
        void refresh();
    }

    function formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
            " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function fileName(path: string): string {
        return path.split("/").pop() ?? path;
    }

    async function handleResolve(e: MouseEvent, id: string) {
        e.stopPropagation();
        await onResolve(id);
        void refresh();
    }

    onMount(() => {
        void refresh();
        disposers.push(
            eventHub.onEvent(EVENT_TEAM_ANNOTATION_CREATED, () => void refresh()),
            eventHub.onEvent(EVENT_TEAM_ANNOTATION_UPDATED, () => void refresh()),
            eventHub.onEvent(EVENT_TEAM_ANNOTATION_RESOLVED, () => void refresh())
        );
    });

    onDestroy(() => {
        for (const dispose of disposers) dispose();
        disposers = [];
    });
</script>

<div class="team-notes">
    <div class="team-notes-header">
        <h4 style="margin: 0;">Team Notes</h4>
        {#if unreadCount > 0}
            <span class="team-notes-badge">{unreadCount}</span>
        {/if}
    </div>

    <div class="team-notes-tabs">
        <button
            class="team-notes-tab"
            class:is-active={activeTab === "mentions"}
            onclick={() => handleTabChange("mentions")}
        >Mentions</button>
        <button
            class="team-notes-tab"
            class:is-active={activeTab === "recent"}
            onclick={() => handleTabChange("recent")}
        >Recent</button>
    </div>

    <div class="team-notes-filter-bar">
        <label style="font-size: 0.8em; color: var(--text-muted);">
            <input type="checkbox" bind:checked={showResolved} />
            Show resolved
        </label>
    </div>

    {#if filteredAnnotations.length === 0}
        <div class="team-notes-empty">No team notes yet.</div>
    {:else}
        {#each filteredAnnotations as ann}
            <div
                class="team-notes-entry"
                class:is-unread={!ann.resolved}
                onclick={() => onOpenAnnotation(ann)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === "Enter" && onOpenAnnotation(ann)}
            >
                <div class="team-notes-entry-file">{fileName(ann.filePath)}</div>
                <div class="team-notes-entry-content">{ann.content}</div>
                <div class="team-notes-entry-meta">
                    {ann.author} &middot; {formatTime(ann.timestamp)}
                    {#if !ann.resolved}
                        &middot; <span
                            style="cursor: pointer; color: var(--interactive-accent);"
                            onclick={(e) => handleResolve(e, ann._id)}
                            role="button"
                            tabindex="0"
                            onkeydown={(e) => e.key === "Enter" && handleResolve(e, ann._id)}
                        >Resolve</span>
                    {/if}
                </div>
            </div>
        {/each}
    {/if}
</div>

<style>
    .team-notes {
        padding: 0;
        overflow-y: auto;
        height: 100%;
    }
    .team-notes-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        position: sticky;
        top: 0;
        background: var(--background-primary);
        z-index: 1;
    }
    .team-notes-badge {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        font-size: 0.75em;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 10px;
        min-width: 16px;
        text-align: center;
    }
    .team-notes-tabs {
        display: flex;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .team-notes-tab {
        flex: 1;
        padding: 6px 12px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        color: var(--text-muted);
        font-size: 0.85em;
    }
    .team-notes-tab.is-active {
        color: var(--text-normal);
        border-bottom-color: var(--interactive-accent);
    }
    .team-notes-filter-bar {
        padding: 6px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .team-notes-empty {
        padding: 24px 12px;
        text-align: center;
        color: var(--text-muted);
    }
    .team-notes-entry {
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .team-notes-entry:hover {
        background: var(--background-modifier-hover);
    }
    .team-notes-entry.is-unread {
        background: var(--background-modifier-hover);
    }
    .team-notes-entry-file {
        font-size: 0.85em;
        font-weight: 600;
        color: var(--text-normal);
    }
    .team-notes-entry-content {
        font-size: 0.85em;
        color: var(--text-normal);
        margin: 2px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .team-notes-entry-meta {
        font-size: 0.75em;
        color: var(--text-muted);
    }
</style>
