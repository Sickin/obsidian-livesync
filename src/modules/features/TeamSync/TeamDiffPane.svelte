<script lang="ts">
    import { onMount } from "svelte";
    import { TeamDiffService } from "./TeamDiffService";

    type Props = {
        filePath: string;
        oldContent: string;
        newContent: string;
        oldRev: string;
        newRev: string;
        authors: string[];
        oldMtime: number;
        newMtime: number;
    };

    const {
        filePath,
        oldContent,
        newContent,
        oldRev,
        newRev,
        authors,
        oldMtime,
        newMtime,
    }: Props = $props();

    let diffHtml = $state("");
    let summary = $state({ added: 0, removed: 0 });

    onMount(() => {
        const diff = TeamDiffService.computeDiff(oldContent, newContent);
        diffHtml = TeamDiffService.renderDiffToHtml(diff);
        summary = TeamDiffService.computeDiffSummary(diff);
    });

    function fileName(path: string): string {
        return path.split("/").pop() ?? path;
    }

    function formatTime(ts: number): string {
        return new Date(ts).toLocaleString();
    }
</script>

<div class="team-diff-view">
    <div class="team-diff-header">
        <div class="team-diff-header-file">{fileName(filePath)}</div>
        <div class="team-diff-header-authors">
            by {authors.join(", ")}
        </div>
    </div>
    <div class="team-diff-summary">
        {oldRev.substring(0, 8)} ({formatTime(oldMtime)}) → {newRev.substring(0, 8)} ({formatTime(newMtime)})
        &nbsp;|&nbsp;
        <span class="team-diff-added">+{summary.added}</span>
        &nbsp;
        <span class="team-diff-deleted">-{summary.removed}</span>
    </div>
    <div class="team-diff-content">
        {@html diffHtml}
    </div>
</div>
