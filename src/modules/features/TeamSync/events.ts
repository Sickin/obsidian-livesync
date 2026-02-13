import type { FilePathWithPrefix } from "../../../lib/src/common/types.ts";
import type { TeamAnnotation } from "./types.ts";

declare global {
    interface LSEvents {
        "team-file-changed": FilePathWithPrefix;
        "team-file-read": FilePathWithPrefix;
        "team-activity-updated": undefined;
        "team-annotation-created": TeamAnnotation;
        "team-annotation-updated": TeamAnnotation;
        "team-annotation-resolved": TeamAnnotation;
    }
}

export const EVENT_TEAM_FILE_CHANGED = "team-file-changed" as const;
export const EVENT_TEAM_FILE_READ = "team-file-read" as const;
export const EVENT_TEAM_ACTIVITY_UPDATED = "team-activity-updated" as const;
export const EVENT_TEAM_ANNOTATION_CREATED = "team-annotation-created" as const;
export const EVENT_TEAM_ANNOTATION_UPDATED = "team-annotation-updated" as const;
export const EVENT_TEAM_ANNOTATION_RESOLVED = "team-annotation-resolved" as const;
