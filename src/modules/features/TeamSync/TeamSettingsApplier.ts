import type { TeamSettingsEntry } from "./types.ts";
import type { TeamOverrideTracker } from "./TeamOverrideTracker.ts";

export interface ApplyResult {
    applied: Record<string, unknown>;
    enforced: string[];
}

export class TeamSettingsApplier {
    constructor(private overrideTracker: TeamOverrideTracker) {}

    async apply(entry: TeamSettingsEntry, currentSettings: Record<string, unknown>): Promise<ApplyResult> {
        const applied = { ...currentSettings };
        const enforced: string[] = [];
        const pluginId = entry._id.replace("team:settings:", "");

        for (const [key, spec] of Object.entries(entry.settings)) {
            if (spec.mode === "enforced") {
                applied[key] = spec.value;
                enforced.push(key);
            } else if (spec.mode === "default") {
                const isOverridden = await this.overrideTracker.isOverridden(pluginId, key);
                if (!isOverridden) {
                    applied[key] = spec.value;
                }
            }
        }

        return { applied, enforced };
    }

    async detectCustomization(
        entry: TeamSettingsEntry,
        settingKey: string,
        newValue: unknown,
    ): Promise<void> {
        const pluginId = entry._id.replace("team:settings:", "");
        const spec = entry.settings[settingKey];
        if (!spec || spec.mode !== "default") return;

        if (newValue === spec.value) {
            await this.overrideTracker.clearOverride(pluginId, settingKey);
        } else {
            await this.overrideTracker.markOverridden(pluginId, settingKey);
        }
    }
}
