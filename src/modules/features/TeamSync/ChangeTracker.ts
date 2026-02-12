import type { TeamActivityEntry } from "./types.ts";

const MAX_ACTIVITY_ENTRIES = 100;

/**
 * Tracks file changes from team members and maintains the activity feed.
 *
 * - Unread files: Set of file paths changed by others since last opened.
 * - Activity feed: Last 100 changes (from anyone), reverse chronological.
 */
export class ChangeTracker {
    private _unreadFiles = new Set<string>();
    private _activityFeed: TeamActivityEntry[] = [];

    constructor(private _currentUsername: string) {}

    /**
     * Record a file change. Adds to activity feed always.
     * Marks as unread only if the change is from someone else.
     */
    trackChange(filePath: string, modifiedBy: string, timestamp: number, rev: string): void {
        // Add to activity feed (all changes, including own)
        this._activityFeed.unshift({
            filePath,
            modifiedBy,
            timestamp,
            rev,
        });

        // Cap the feed
        if (this._activityFeed.length > MAX_ACTIVITY_ENTRIES) {
            this._activityFeed.length = MAX_ACTIVITY_ENTRIES;
        }

        // Only mark as unread if from someone else
        if (modifiedBy !== this._currentUsername) {
            this._unreadFiles.add(filePath);
        }
    }

    /**
     * Mark a file as read (clear unread indicator).
     */
    markAsRead(filePath: string): void {
        this._unreadFiles.delete(filePath);
    }

    /**
     * Get the set of currently unread file paths.
     */
    getUnreadFiles(): Set<string> {
        return new Set(this._unreadFiles);
    }

    /**
     * Check if a specific file is unread.
     */
    isUnread(filePath: string): boolean {
        return this._unreadFiles.has(filePath);
    }

    /**
     * Get the activity feed (reverse chronological).
     */
    getActivityFeed(): TeamActivityEntry[] {
        return [...this._activityFeed];
    }

    /**
     * Update the current username (e.g., after settings change).
     */
    setCurrentUsername(username: string): void {
        this._currentUsername = username;
    }
}
