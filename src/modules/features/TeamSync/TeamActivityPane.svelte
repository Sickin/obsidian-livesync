<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { TeamActivityEntry } from "./types";
    import { eventHub } from "../../../common/events";
    import { EVENT_TEAM_ACTIVITY_UPDATED, EVENT_TEAM_FILE_READ } from "./events";

    type Props = {
        getActivityFeed: () => TeamActivityEntry[];
        getUnreadFiles: () => Set<string>;
        onOpenFile: (filePath: string) => void;
    };

    const { getActivityFeed, getUnreadFiles, onOpenFile }: Props = $props();

    let feed = $state<TeamActivityEntry[]>([]);
    let unreadFiles = $state<Set<string>>(new Set());
    let disposers: (() => void)[] = [];

    function refresh() {
        feed = getActivityFeed();
        unreadFiles = getUnreadFiles();
    }

    onMount(() => {
        refresh();
        disposers.push(
            eventHub.onEvent(EVENT_TEAM_ACTIVITY_UPDATED, refresh),
            eventHub.onEvent(EVENT_TEAM_FILE_READ, refresh)
        );
    });

    onDestroy(() => {
        for (const dispose of disposers) {
            dispose();
        }
        disposers = [];
    });

    function formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
            " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function getInitials(username: string): string {
        return username.slice(0, 2).toUpperCase();
    }

    function fileName(path: string): string {
        return path.split("/").pop() ?? path;
    }

    function folderPath(path: string): string {
        const parts = path.split("/");
        if (parts.length <= 1) return "";
        return parts.slice(0, -1).join("/");
    }

    // Group feed by day
    const groupedFeed = $derived.by(() => {
        const groups: { date: string; entries: TeamActivityEntry[] }[] = [];
        let currentDate = "";

        for (const entry of feed) {
            const date = new Date(entry.timestamp).toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
            });
            if (date !== currentDate) {
                currentDate = date;
                groups.push({ date, entries: [] });
            }
            groups[groups.length - 1].entries.push(entry);
        }
        return groups;
    });
</script>

<div class="team-activity">
    <h4 class="team-activity-header">Team Activity</h4>

    {#if feed.length === 0}
        <div class="team-activity-empty">No team activity yet.</div>
    {:else}
        {#each groupedFeed as group}
            <div class="team-activity-date">{group.date}</div>
            {#each group.entries as entry}
                <div
                    class="team-activity-entry"
                    class:is-unread={unreadFiles.has(entry.filePath)}
                    onclick={() => onOpenFile(entry.filePath)}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === "Enter" && onOpenFile(entry.filePath)}
                >
                    <span class="team-activity-avatar" title={entry.modifiedBy}>
                        {getInitials(entry.modifiedBy)}
                    </span>
                    <div class="team-activity-info">
                        <div class="team-activity-file">
                            {fileName(entry.filePath)}
                            {#if unreadFiles.has(entry.filePath)}
                                <span class="team-unread-dot"></span>
                            {/if}
                        </div>
                        <div class="team-activity-meta">
                            {folderPath(entry.filePath)} &middot; {formatTime(entry.timestamp)}
                        </div>
                    </div>
                </div>
            {/each}
        {/each}
    {/if}
</div>

<style>
    .team-activity {
        padding: 0;
        overflow-y: auto;
        height: 100%;
    }
    .team-activity-header {
        padding: 8px 12px;
        margin: 0;
        border-bottom: 1px solid var(--background-modifier-border);
        position: sticky;
        top: 0;
        background: var(--background-primary);
        z-index: 1;
    }
    .team-activity-empty {
        padding: 24px 12px;
        text-align: center;
        color: var(--text-muted);
    }
    .team-activity-date {
        padding: 6px 12px;
        font-size: 0.8em;
        font-weight: 600;
        color: var(--text-muted);
        background: var(--background-secondary);
    }
    .team-activity-entry {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .team-activity-entry:hover {
        background: var(--background-modifier-hover);
    }
    .team-activity-entry.is-unread {
        background: var(--background-modifier-hover);
    }
    .team-activity-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.7em;
        font-weight: 600;
        flex-shrink: 0;
    }
    .team-activity-info {
        flex: 1;
        min-width: 0;
    }
    .team-activity-file {
        font-size: 0.9em;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .team-activity-meta {
        font-size: 0.75em;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .team-unread-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--interactive-accent);
        flex-shrink: 0;
    }
</style>
