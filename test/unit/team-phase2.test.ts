import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { generateHarness, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ReadStateManager } from "../../src/modules/features/TeamSync/ReadStateManager";

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
