import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { generateHarness, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ReadStateManager } from "../../src/modules/features/TeamSync/ReadStateManager";
import { ChangeTracker } from "../../src/modules/features/TeamSync/ChangeTracker";

describe("ReadStateManager", async () => {
    let harness: LiveSyncHarness;
    let readState: ReadStateManager;
    const vaultName = "TestVaultReadState" + Date.now();

    beforeAll(async () => {
        harness = await generateHarness(vaultName);
        await waitForReady(harness);
        const store = harness.plugin.services.database.openSimpleStore<any>("team-readstate");
        readState = new ReadStateManager(store);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    it("should report file as unread when no state exists", async () => {
        const isUnread = await readState.isUnread("notes/test.md", "2-abc123");
        expect(isUnread).toBe(true);
    });

    it("should mark a file as read", async () => {
        await readState.markAsRead("notes/test.md", "2-abc123");
        const isUnread = await readState.isUnread("notes/test.md", "2-abc123");
        expect(isUnread).toBe(false);
    });

    it("should report file as unread when rev changes", async () => {
        await readState.markAsRead("notes/test.md", "2-abc123");
        const isUnread = await readState.isUnread("notes/test.md", "3-def456");
        expect(isUnread).toBe(true);
    });

    it("should get read state for a file", async () => {
        await readState.markAsRead("notes/test.md", "5-xyz");
        const state = await readState.getReadState("notes/test.md");
        expect(state).not.toBeUndefined();
        expect(state!.lastSeenRev).toBe("5-xyz");
        expect(state!.lastSeenAt).toBeGreaterThan(0);
    });

    it("should clear read state for a file", async () => {
        await readState.markAsRead("notes/test.md", "5-xyz");
        await readState.clearReadState("notes/test.md");
        const state = await readState.getReadState("notes/test.md");
        expect(state).toBeUndefined();
    });
});

describe("ChangeTracker", () => {
    let tracker: ChangeTracker;

    beforeAll(() => {
        tracker = new ChangeTracker("current-user");
    });

    it("should start with no unread files", () => {
        expect(tracker.getUnreadFiles()).toEqual(new Set());
    });

    it("should start with empty activity feed", () => {
        expect(tracker.getActivityFeed()).toEqual([]);
    });

    it("should track a change from another user", () => {
        tracker.trackChange("notes/hello.md", "other-user", Date.now(), "2-abc");
        expect(tracker.getUnreadFiles().has("notes/hello.md")).toBe(true);
        expect(tracker.getActivityFeed()).toHaveLength(1);
        expect(tracker.getActivityFeed()[0].modifiedBy).toBe("other-user");
    });

    it("should NOT track changes from the current user as unread", () => {
        tracker.trackChange("notes/mine.md", "current-user", Date.now(), "1-xyz");
        expect(tracker.getUnreadFiles().has("notes/mine.md")).toBe(false);
    });

    it("should add to activity feed even for current user changes", () => {
        const feedBefore = tracker.getActivityFeed().length;
        tracker.trackChange("notes/mine2.md", "current-user", Date.now(), "1-abc");
        expect(tracker.getActivityFeed().length).toBe(feedBefore + 1);
    });

    it("should mark a file as read", () => {
        tracker.trackChange("notes/toread.md", "other-user", Date.now(), "3-abc");
        expect(tracker.getUnreadFiles().has("notes/toread.md")).toBe(true);
        tracker.markAsRead("notes/toread.md");
        expect(tracker.getUnreadFiles().has("notes/toread.md")).toBe(false);
    });

    it("should cap activity feed at 100 entries", () => {
        for (let i = 0; i < 110; i++) {
            tracker.trackChange(`notes/file${i}.md`, "other-user", Date.now() + i, `${i}-rev`);
        }
        expect(tracker.getActivityFeed().length).toBeLessThanOrEqual(100);
    });

    it("should return activity feed in reverse chronological order", () => {
        const feed = tracker.getActivityFeed();
        for (let i = 1; i < feed.length; i++) {
            expect(feed[i - 1].timestamp).toBeGreaterThanOrEqual(feed[i].timestamp);
        }
    });
});
