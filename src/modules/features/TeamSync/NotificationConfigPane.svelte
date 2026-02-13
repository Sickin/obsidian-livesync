<script lang="ts">
    import type { TeamNotificationConfig, WebhookConfig, SmtpConfig, WebhookPlatform } from "./types.ts";

    interface Props {
        getConfig: () => Promise<TeamNotificationConfig | null>;
        onSave: (config: Omit<TeamNotificationConfig, "_id" | "_rev">) => Promise<void>;
        onTest: (channel: "webhook" | "smtp", index?: number) => Promise<boolean>;
    }

    let { getConfig, onSave, onTest }: Props = $props();

    let webhooks: WebhookConfig[] = $state([]);
    let smtp: SmtpConfig = $state({
        host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false,
    });
    let saving = $state(false);
    let dirty = $state(false);
    let testResult = $state("");

    async function load() {
        const config = await getConfig();
        if (config) {
            webhooks = config.webhooks.map((w) => ({ ...w }));
            smtp = { ...config.smtp };
        }
        dirty = false;
    }

    function addWebhook() {
        webhooks = [...webhooks, { url: "", platform: "generic" as WebhookPlatform, enabled: true, label: "" }];
        dirty = true;
    }

    function removeWebhook(index: number) {
        webhooks = webhooks.filter((_, i) => i !== index);
        dirty = true;
    }

    function markDirty() {
        dirty = true;
    }

    async function save() {
        saving = true;
        try {
            await onSave({ webhooks, smtp });
            dirty = false;
        } finally {
            saving = false;
        }
    }

    async function testChannel(channel: "webhook" | "smtp", index?: number) {
        testResult = "Testing...";
        const ok = await onTest(channel, index);
        testResult = ok ? "Sent!" : "Failed";
        setTimeout(() => { testResult = ""; }, 3000);
    }

    load();
</script>

<div class="team-notification-config">
    <h3>Webhook Endpoints</h3>
    <div class="team-webhook-list">
        {#each webhooks as webhook, i (i)}
            <div class="team-webhook-item">
                <input type="text" placeholder="Label" bind:value={webhook.label} oninput={markDirty} style="width: 80px;" />
                <select bind:value={webhook.platform} onchange={markDirty}>
                    <option value="slack">Slack</option>
                    <option value="discord">Discord</option>
                    <option value="teams">Teams</option>
                    <option value="generic">Generic</option>
                </select>
                <input type="text" placeholder="Webhook URL" bind:value={webhook.url} oninput={markDirty} />
                <label><input type="checkbox" bind:checked={webhook.enabled} onchange={markDirty} /> On</label>
                <button class="team-webhook-remove" onclick={() => removeWebhook(i)} title="Remove">&times;</button>
            </div>
        {/each}
    </div>
    <button onclick={addWebhook}>+ Add Webhook</button>

    <h3 style="margin-top: 16px;">SMTP (Email)</h3>
    <div class="team-smtp-config">
        <label>Enabled</label>
        <label><input type="checkbox" bind:checked={smtp.enabled} onchange={markDirty} /></label>
        <label>Host</label>
        <input type="text" placeholder="smtp.example.com" bind:value={smtp.host} oninput={markDirty} />
        <label>Port</label>
        <input type="number" bind:value={smtp.port} oninput={markDirty} />
        <label>TLS</label>
        <label><input type="checkbox" bind:checked={smtp.secure} onchange={markDirty} /></label>
        <label>Username</label>
        <input type="text" bind:value={smtp.username} oninput={markDirty} />
        <label>Password</label>
        <input type="password" bind:value={smtp.password} oninput={markDirty} />
        <label>From</label>
        <input type="text" placeholder="team@example.com" bind:value={smtp.fromAddress} oninput={markDirty} />
    </div>

    <div class="team-notification-test">
        <button onclick={() => testChannel("smtp")}>Test Email</button>
        {#if testResult}
            <span class="team-notification-test-result" class:success={testResult === "Sent!"} class:error={testResult === "Failed"}>{testResult}</span>
        {/if}
    </div>

    {#if dirty}
        <div class="team-settings-save">
            <button class="mod-cta" onclick={save} disabled={saving}>
                {saving ? "Saving\u2026" : "Save Notification Config"}
            </button>
        </div>
    {/if}
</div>
