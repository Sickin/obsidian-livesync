// src/modules/features/TeamSync/types.ts

export type TeamRole = "admin" | "editor" | "viewer";

export interface TeamMember {
    role: TeamRole;
    lastSync?: string; // ISO timestamp
}

export interface TeamConfig {
    _id: "team:config";
    _rev?: string;
    teamName: string;
    members: Record<string, TeamMember>; // keyed by CouchDB username
    features: {
        annotations: boolean;
        settingsPush: boolean;
        changeIndicators: boolean;
    };
}

export interface TeamSettingsEntry {
    _id: `team:settings:${string}`;
    _rev?: string;
    managedBy: string;
    updatedAt: string;
    settings: Record<string, {
        value: unknown;
        mode: "default" | "enforced";
    }>;
}

export interface TeamAnnotation {
    _id: `team:annotation:${string}`;
    _rev?: string;
    filePath: string;
    range: {
        startLine: number;
        startChar: number;
        endLine: number;
        endChar: number;
    };
    contextBefore: string;
    contextAfter: string;
    content: string;
    author: string;
    mentions: string[];
    timestamp: string;
    resolved: boolean;
    parentId: string | null;
}

/**
 * Minimal type for documents with team attribution.
 * Used with type assertion when writing docs — CouchDB stores the field
 * even though the base SavingEntry type doesn't declare it.
 */
export interface TeamAttributedDoc {
    modifiedBy?: string;
}

export const TEAM_CONFIG_ID = "team:config" as const;

export function isTeamDoc(id: string): boolean {
    return id.startsWith("team:");
}

export function createDefaultTeamConfig(teamName: string, adminUsername: string): TeamConfig {
    return {
        _id: TEAM_CONFIG_ID,
        teamName,
        members: {
            [adminUsername]: { role: "admin" },
        },
        features: {
            annotations: false,
            settingsPush: false,
            changeIndicators: true,
        },
    };
}
