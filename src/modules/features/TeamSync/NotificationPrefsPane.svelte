<script lang="ts">
    import type { UserNotificationPrefs, NotificationEventType } from "./types.ts";

    interface Props {
        username: string;
        getPrefs: () => Promise<UserNotificationPrefs | null>;
        onSave: (prefs: Omit<UserNotificationPrefs, "_id" | "_rev">) => Promise<void>;
        hasSmtp: boolean;
        hasWebhooks: boolean;
    }

    let { username, getPrefs, onSave, hasSmtp, hasWebhooks }: Props = $props();

    const eventTypes: { key: NotificationEventType; label: string; description: string }[] = [
        { key: "mention", label: "Mentions", description: "When someone @mentions you in a team note" },
        { key: "annotation-reply", label: "Replies", description: "When someone replies to your team note" },
        { key: "file-change", label: "File changes", description: "When a file you've read is changed by another team member" },
        { key: "settings-push", label: "Settings push", description: "When team settings are applied to your vault" },
    ];

    let enabledEvents: Set<NotificationEventType> = $state(new Set());
    let emailEnabled = $state(false);
    let webhookEnabled = $state(false);
    let userEmail = $state("");
    let saving = $state(false);
    let dirty = $state(false);

    async function load() {
        const prefs = await getPrefs();
        if (prefs) {
            enabledEvents = new Set(prefs.enabledEvents);
            emailEnabled = prefs.channels.email;
            webhookEnabled = prefs.channels.webhook;
            userEmail = prefs.email ?? "";
        }
        dirty = false;
    }

    function toggleEvent(key: NotificationEventType) {
        if (enabledEvents.has(key)) {
            enabledEvents.delete(key);
        } else {
            enabledEvents.add(key);
        }
        enabledEvents = new Set(enabledEvents);
        dirty = true;
    }

    function markDirty() {
        dirty = true;
    }

    async function save() {
        saving = true;
        try {
            await onSave({
                username,
                email: userEmail || undefined,
                enabledEvents: [...enabledEvents],
                channels: { email: emailEnabled, webhook: webhookEnabled },
            });
            dirty = false;
        } finally {
            saving = false;
        }
    }

    load();
</script>

<div class="team-notification-prefs">
    <h3>Notification Preferences</h3>

    <div style="margin-bottom: 12px;">
        <div class="team-notification-prefs-row">
            <label>Email address</label>
            <input type="email" placeholder="your@email.com" bind:value={userEmail} oninput={markDirty} style="width: 200px;" />
        </div>
    </div>

    <div style="margin-bottom: 12px;">
        <div class="team-notification-channel-toggles" style="padding: 6px 10px;">
            {#if hasSmtp}
                <label><input type="checkbox" bind:checked={emailEnabled} onchange={markDirty} /> Email</label>
            {/if}
            {#if hasWebhooks}
                <label><input type="checkbox" bind:checked={webhookEnabled} onchange={markDirty} /> Webhook</label>
            {/if}
        </div>
    </div>

    <div>
        {#each eventTypes as evt (evt.key)}
            <div class="team-notification-prefs-row">
                <label>
                    <input
                        type="checkbox"
                        checked={enabledEvents.has(evt.key)}
                        onchange={() => toggleEvent(evt.key)}
                    />
                    {evt.label}
                    <span style="color: var(--text-muted); font-size: 0.8em; margin-left: 4px;">{evt.description}</span>
                </label>
            </div>
        {/each}
    </div>

    {#if dirty}
        <div class="team-settings-save">
            <button class="mod-cta" onclick={save} disabled={saving}>
                {saving ? "Saving\u2026" : "Save Preferences"}
            </button>
        </div>
    {/if}
</div>
