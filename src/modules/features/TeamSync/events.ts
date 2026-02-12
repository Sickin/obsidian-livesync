import type { FilePathWithPrefix } from "../../../lib/src/common/types.ts";

declare global {
    interface LSEvents {
        "team-file-changed": FilePathWithPrefix;
        "team-file-read": FilePathWithPrefix;
        "team-activity-updated": undefined;
    }
}

export const EVENT_TEAM_FILE_CHANGED = "team-file-changed" as const;
export const EVENT_TEAM_FILE_READ = "team-file-read" as const;
export const EVENT_TEAM_ACTIVITY_UPDATED = "team-activity-updated" as const;
