import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockDB() {
    const docs = new Map<string, any>();
    return {
        get: async (id: string) => {
            const doc = docs.get(id);
            if (!doc) throw { status: 404 };
            return { ...doc };
        },
        put: async (doc: any) => {
            const rev = `${(parseInt((docs.get(doc._id)?._rev ?? "0").split("-")[0]) || 0) + 1}-mock`;
            docs.set(doc._id, { ...doc, _rev: rev });
            return { ok: true, id: doc._id, rev };
        },
        allDocs: async (opts: any) => {
            const rows: any[] = [];
            for (const [id, doc] of docs.entries()) {
                if (opts.startkey && id < opts.startkey) continue;
                if (opts.endkey && id > opts.endkey) continue;
                if ((doc as any)._deleted) continue;
                rows.push({ id, doc: opts.include_docs ? doc : undefined });
            }
            return { rows };
        },
    };
}

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

describe("SmtpChannel", () => {
    it("should build email content with correct headers", async () => {
        const { SmtpChannel } = await import(
            "../../src/modules/features/TeamSync/SmtpChannel"
        );
        const channel = new SmtpChannel();
        const email = channel.buildEmail({
            from: "team@example.com",
            to: "bob@example.com",
            subject: "New mention in LiveSync",
            body: "Alice mentioned you in notes/test.md",
        });
        expect(email).toContain("From: team@example.com");
        expect(email).toContain("To: bob@example.com");
        expect(email).toContain("Subject: New mention in LiveSync");
        expect(email).toContain("Alice mentioned you");
    });

    it("should format notification as email subject and body", async () => {
        const { SmtpChannel } = await import(
            "../../src/modules/features/TeamSync/SmtpChannel"
        );
        const channel = new SmtpChannel();
        const { subject, body } = channel.formatNotification({
            type: "mention" as const,
            title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice",
            targets: ["bob"],
            timestamp: "2026-02-12T10:00:00Z",
        });
        expect(subject).toContain("LiveSync");
        expect(body).toContain("Alice mentioned you");
    });

    it("should return false when SMTP is disabled", async () => {
        const { SmtpChannel } = await import(
            "../../src/modules/features/TeamSync/SmtpChannel"
        );
        const channel = new SmtpChannel();
        const result = await channel.send(
            { host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false },
            "bob@example.com",
            { type: "mention" as const, title: "T", body: "B", actor: "a", targets: ["b"], timestamp: "2026-02-12T10:00:00Z" },
        );
        expect(result).toBe(false);
    });
});

describe("NotificationStore", () => {
    let store: any;
    let mockDB: any;

    beforeEach(async () => {
        const { NotificationStore } = await import(
            "../../src/modules/features/TeamSync/NotificationStore"
        );
        mockDB = createMockDB();
        store = new NotificationStore({ localDatabase: mockDB } as any);
    });

    it("should save and retrieve notification config", async () => {
        const config = {
            _id: "team:notifications:config" as const,
            webhooks: [{ url: "https://hooks.slack.com/test", platform: "slack" as const, enabled: true, label: "Slack" }],
            smtp: { host: "smtp.example.com", port: 587, secure: false, username: "user", password: "pass", fromAddress: "team@example.com", enabled: true },
        };
        await store.saveConfig(config);
        const fetched = await store.getConfig();
        expect(fetched).not.toBeNull();
        expect(fetched!.webhooks.length).toBe(1);
        expect(fetched!.smtp.host).toBe("smtp.example.com");
    });

    it("should return null for missing config", async () => {
        const result = await store.getConfig();
        expect(result).toBeNull();
    });

    it("should save and retrieve user preferences", async () => {
        const prefs = {
            _id: "team:notifications:prefs:bob" as const,
            username: "bob",
            email: "bob@example.com",
            enabledEvents: ["mention" as const, "annotation-reply" as const],
            channels: { email: true, webhook: true },
        };
        await store.savePrefs(prefs);
        const fetched = await store.getPrefs("bob");
        expect(fetched).not.toBeNull();
        expect(fetched!.email).toBe("bob@example.com");
        expect(fetched!.enabledEvents).toContain("mention");
    });

    it("should return null for missing user preferences", async () => {
        const result = await store.getPrefs("nonexistent");
        expect(result).toBeNull();
    });

    it("should list all user preferences", async () => {
        await store.savePrefs({
            _id: "team:notifications:prefs:alice" as const,
            username: "alice", enabledEvents: ["mention" as const], channels: { email: false, webhook: true },
        });
        await store.savePrefs({
            _id: "team:notifications:prefs:bob" as const,
            username: "bob", enabledEvents: ["file-change" as const], channels: { email: true, webhook: false },
        });
        const all = await store.getAllPrefs();
        expect(all.length).toBe(2);
    });

    it("should update existing preferences preserving _rev", async () => {
        await store.savePrefs({
            _id: "team:notifications:prefs:bob" as const,
            username: "bob", enabledEvents: ["mention" as const], channels: { email: false, webhook: false },
        });
        const first = await store.getPrefs("bob");
        first!.channels.email = true;
        await store.savePrefs(first!);
        const updated = await store.getPrefs("bob");
        expect(updated!.channels.email).toBe(true);
    });
});
