import { describe, it, expect, vi, beforeEach } from "vitest";

describe("WebhookChannel", () => {
    let channel: any;
    let fetchSpy: any;

    beforeEach(async () => {
        const { WebhookChannel } = await import(
            "../../src/modules/features/TeamSync/WebhookChannel"
        );
        channel = new WebhookChannel();
        fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal("fetch", fetchSpy);
    });

    it("should format Slack message correctly", () => {
        const body = channel.formatPayload("slack", {
            type: "mention", title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body.text).toContain("Alice mentioned you");
    });

    it("should format Discord message correctly", () => {
        const body = channel.formatPayload("discord", {
            type: "mention", title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body.embeds).toBeDefined();
        expect(body.embeds[0].title).toBe("New mention");
    });

    it("should format Teams message correctly", () => {
        const body = channel.formatPayload("teams", {
            type: "mention", title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body["@type"]).toBe("MessageCard");
    });

    it("should format generic JSON payload", () => {
        const body = channel.formatPayload("generic", {
            type: "file-change", title: "File changed",
            body: "notes/readme.md was updated by alice",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body.type).toBe("file-change");
        expect(body.title).toBe("File changed");
    });

    it("should send webhook with correct headers", async () => {
        const config = { url: "https://hooks.example.com/test", platform: "generic" as const, enabled: true, label: "Test" };
        const notification = {
            type: "mention" as const, title: "Test", body: "Test body",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        };
        const result = await channel.send(config, notification);
        expect(result).toBe(true);
        expect(fetchSpy).toHaveBeenCalledWith("https://hooks.example.com/test", expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({ "Content-Type": "application/json" }),
        }));
    });

    it("should return false on fetch failure", async () => {
        fetchSpy.mockResolvedValue({ ok: false, status: 500 });
        const config = { url: "https://hooks.example.com/fail", platform: "generic" as const, enabled: true, label: "Fail" };
        const notification = {
            type: "mention" as const, title: "T", body: "B",
            actor: "a", targets: ["b"], timestamp: "2026-02-12T10:00:00Z",
        };
        const result = await channel.send(config, notification);
        expect(result).toBe(false);
    });

    it("should skip disabled webhook config", async () => {
        const config = { url: "https://hooks.example.com/off", platform: "generic" as const, enabled: false, label: "Off" };
        const notification = {
            type: "mention" as const, title: "T", body: "B",
            actor: "a", targets: ["b"], timestamp: "2026-02-12T10:00:00Z",
        };
        const result = await channel.send(config, notification);
        expect(result).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
