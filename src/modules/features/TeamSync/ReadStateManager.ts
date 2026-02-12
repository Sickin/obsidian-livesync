import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { FileReadState } from "./types.ts";

/**
 * Manages per-file read state in local SimpleStore (IndexedDB).
 * Not synced to CouchDB — each user has their own read state.
 *
 * A file is "unread" if:
 * - No read state exists for it, OR
 * - The file's current revision differs from the last-seen revision
 */
export class ReadStateManager {
    constructor(private store: SimpleStore<FileReadState>) {}

    /**
     * Check if a file is unread (current rev differs from last-seen rev).
     */
    async isUnread(filePath: string, currentRev: string): Promise<boolean> {
        const state = await this.getReadState(filePath);
        if (!state) return true;
        return state.lastSeenRev !== currentRev;
    }

    /**
     * Mark a file as read at the given revision.
     */
    async markAsRead(filePath: string, rev: string): Promise<void> {
        await this.store.set(filePath, {
            lastSeenRev: rev,
            lastSeenAt: Date.now(),
        });
    }

    /**
     * Get the read state for a file.
     */
    async getReadState(filePath: string): Promise<FileReadState | undefined> {
        return await this.store.get(filePath);
    }

    /**
     * Clear read state for a file.
     */
    async clearReadState(filePath: string): Promise<void> {
        await this.store.delete(filePath);
    }
}
