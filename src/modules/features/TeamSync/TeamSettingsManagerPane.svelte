<script lang="ts">
    import type { TeamSettingsEntry } from "./types.ts";

    type Mode = "none" | "default" | "enforced";
    interface SettingRow {
        key: string;
        mode: Mode;
        value: unknown;
    }

    interface Props {
        settingKeys: string[];
        getEntry: () => Promise<TeamSettingsEntry | null>;
        getCurrentSettings: () => Record<string, unknown>;
        onSave: (entry: Omit<TeamSettingsEntry, "_id" | "_rev">) => Promise<void>;
    }

    let { settingKeys, getEntry, getCurrentSettings, onSave }: Props = $props();

    let rows: SettingRow[] = $state([]);
    let filter = $state("");
    let saving = $state(false);
    let dirty = $state(false);

    let filteredRows = $derived(
        filter
            ? rows.filter((r) => r.key.toLowerCase().includes(filter.toLowerCase()))
            : rows
    );

    let managedCount = $derived(rows.filter((r) => r.mode !== "none").length);

    async function load() {
        const currentSettings = getCurrentSettings();
        const entry = await getEntry();
        const managed = entry?.settings ?? {};

        rows = settingKeys.map((key) => ({
            key,
            mode: (managed[key]?.mode ?? "none") as Mode,
            value: currentSettings[key],
        }));
        dirty = false;
    }

    function setMode(key: string, mode: Mode) {
        const idx = rows.findIndex((r) => r.key === key);
        if (idx !== -1) {
            rows[idx] = { ...rows[idx], mode };
            rows = [...rows];
            dirty = true;
        }
    }

    async function save() {
        saving = true;
        try {
            const currentSettings = getCurrentSettings();
            const settings: Record<string, { value: unknown; mode: "default" | "enforced" }> = {};
            for (const row of rows) {
                if (row.mode !== "none") {
                    settings[row.key] = {
                        value: currentSettings[row.key],
                        mode: row.mode as "default" | "enforced",
                    };
                }
            }
            await onSave({
                managedBy: "",
                updatedAt: new Date().toISOString(),
                settings,
            });
            dirty = false;
        } finally {
            saving = false;
        }
    }

    function formatValue(val: unknown): string {
        if (val === undefined || val === null) return "\u2014";
        if (typeof val === "boolean") return val ? "true" : "false";
        if (typeof val === "string") return val.length > 20 ? val.slice(0, 20) + "\u2026" : val;
        if (typeof val === "number") return String(val);
        return typeof val;
    }

    load();
</script>

<div class="team-settings-manager">
    <div class="team-settings-manager-header">
        <h3>Managed Settings ({managedCount})</h3>
    </div>

    <input
        class="team-settings-search"
        type="text"
        placeholder="Filter settings\u2026"
        bind:value={filter}
    />

    <div class="team-settings-list">
        {#each filteredRows as row (row.key)}
            <div class="team-settings-row">
                <span class="team-settings-row-key" title={row.key}>{row.key}</span>
                <span class="team-settings-row-value" title={String(row.value ?? "")}>
                    {formatValue(row.value)}
                </span>
                <div class="team-settings-mode-toggle">
                    <button
                        class:active-none={row.mode === "none"}
                        onclick={() => setMode(row.key, "none")}
                        title="Not managed — members keep their own value"
                    >&mdash;</button>
                    <button
                        class:active-default={row.mode === "default"}
                        onclick={() => setMode(row.key, "default")}
                        title="Default — pushed unless member customized"
                    >D</button>
                    <button
                        class:active-enforced={row.mode === "enforced"}
                        onclick={() => setMode(row.key, "enforced")}
                        title="Enforced — always overrides local value"
                    >E</button>
                </div>
            </div>
        {/each}
    </div>

    {#if dirty}
        <div class="team-settings-save">
            <button class="mod-cta" onclick={save} disabled={saving}>
                {saving ? "Saving\u2026" : "Save Team Settings"}
            </button>
        </div>
    {/if}
</div>
