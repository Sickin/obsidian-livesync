<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { TeamAnnotation } from "./types";

    type Props = {
        mode: "create" | "view";
        annotation?: TeamAnnotation;
        replies?: TeamAnnotation[];
        members?: string[];
        anchorEl: HTMLElement;
        onSubmit: (content: string, mentions: string[]) => void;
        onReply: (content: string, mentions: string[]) => void;
        onResolve: () => void;
        onClose: () => void;
    };

    const {
        mode,
        annotation,
        replies = [],
        members = [],
        anchorEl,
        onSubmit,
        onReply,
        onResolve,
        onClose,
    }: Props = $props();

    let content = $state("");
    let replyContent = $state("");
    let popoverEl: HTMLElement | undefined = $state();

    function parseMentions(text: string): string[] {
        const matches = text.match(/@(\w+)/g);
        if (!matches) return [];
        return [...new Set(matches.map((m) => m.slice(1)))];
    }

    function handleSubmit() {
        if (!content.trim()) return;
        onSubmit(content, parseMentions(content));
    }

    function handleReply() {
        if (!replyContent.trim()) return;
        onReply(replyContent, parseMentions(replyContent));
        replyContent = "";
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

    function positionPopover() {
        if (!popoverEl || !anchorEl) return;
        const rect = anchorEl.getBoundingClientRect();
        popoverEl.style.top = `${rect.bottom + 4}px`;
        popoverEl.style.left = `${Math.max(8, rect.left)}px`;
    }

    function handleClickOutside(e: MouseEvent) {
        if (popoverEl && !popoverEl.contains(e.target as Node)) {
            onClose();
        }
    }

    onMount(() => {
        positionPopover();
        document.addEventListener("mousedown", handleClickOutside);
    });

    onDestroy(() => {
        document.removeEventListener("mousedown", handleClickOutside);
    });
</script>

<div class="team-annotation-popover" bind:this={popoverEl}>
    {#if mode === "create"}
        <div class="team-annotation-popover-header">
            <span class="team-annotation-popover-author">Add Team Note</span>
        </div>
        <textarea
            class="team-annotation-reply-input"
            bind:value={content}
            placeholder="Type your note... Use @username to mention"
        ></textarea>
        <div class="team-annotation-popover-actions">
            <button class="team-annotation-reply-submit" onclick={handleSubmit}>Add Note</button>
            <button onclick={onClose}>Cancel</button>
        </div>
    {:else if annotation}
        <div class="team-annotation-popover-header">
            <span class="team-annotation-popover-author">{annotation.author}</span>
            <span class="team-annotation-popover-time">{formatTime(annotation.timestamp)}</span>
        </div>
        <div class="team-annotation-popover-content">{annotation.content}</div>
        <div class="team-annotation-popover-actions">
            {#if !annotation.resolved}
                <button onclick={onResolve}>Resolve</button>
            {:else}
                <span style="color: var(--text-muted); font-size: 0.85em;">Resolved</span>
            {/if}
        </div>

        {#if replies.length > 0}
            <div class="team-annotation-thread">
                {#each replies as reply}
                    <div class="team-annotation-reply">
                        <span class="team-annotation-reply-author">{reply.author}</span>
                        <span class="team-annotation-reply-time">{formatTime(reply.timestamp)}</span>
                        <div class="team-annotation-reply-content">{reply.content}</div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if !annotation.resolved}
            <textarea
                class="team-annotation-reply-input"
                bind:value={replyContent}
                placeholder="Reply... Use @username to mention"
            ></textarea>
            <button class="team-annotation-reply-submit" onclick={handleReply}>Reply</button>
        {/if}
    {/if}
</div>
