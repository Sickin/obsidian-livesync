# Phase 6 — Extended Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable team notifications outside of Obsidian via webhooks (Slack/Discord/Teams) and email (SMTP), with per-user notification preferences.

**Architecture:** A `NotificationService` dispatches notifications through pluggable `NotificationChannel` implementations (`WebhookChannel` and `SmtpChannel`). When team events fire (annotation @mentions, file changes, settings pushes), the service checks per-user preferences stored in CouchDB and sends via configured channels. Admin configures SMTP/webhook endpoints; each user configures which events they want notified about and via which channels.

**Tech Stack:** Native `fetch()` for webhooks, Node.js `net`/`tls` modules for SMTP (no external dependencies), PouchDB for notification config/prefs storage, Svelte 5 for settings UI.

**Reference files:**
- `src/modules/features/TeamSync/types.ts` — existing team types
- `src/modules/features/TeamSync/events.ts` — existing team events
- `src/modules/features/TeamSync/TeamSettingsStore.ts` — store pattern
- `src/modules/features/TeamSync/AnnotationStore.ts` — store pattern
- `src/modules/features/TeamSync/ModuleTeamSync.ts` — module wiring
- `src/modules/features/TeamSync/TeamSettingsManagerPane.svelte` — Svelte 5 admin UI pattern

---

### Task 1: Notification Types

All TypeScript interfaces and CouchDB document types for the notification system.

**Files:**
- Modify: `src/modules/features/TeamSync/types.ts`

**Step 1: Add the types**

Append to `src/modules/features/TeamSync/types.ts`:

```typescript
// ── Phase 6: Extended Notifications ───────────────────

export type NotificationEventType = "mention" | "file-change" | "settings-push" | "annotation-reply";

export interface TeamNotification {
    type: NotificationEventType;
    title: string;
    body: string;
    actor: string;       // username who triggered it
    targets: string[];   // usernames who should receive it
    timestamp: string;   // ISO
    metadata?: {
        filePath?: string;
        annotationId?: string;
        settingKeys?: string[];
    };
}

export type WebhookPlatform = "slack" | "discord" | "teams" | "generic";

export interface WebhookConfig {
    url: string;
    platform: WebhookPlatform;
    enabled: boolean;
    label: string; // human-readable name
}

export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;       // true = TLS on connect, false = STARTTLS
    username: string;
    password: string;
    fromAddress: string;
    enabled: boolean;
}

export interface TeamNotificationConfig {
    _id: "team:notifications:config";
    _rev?: string;
    webhooks: WebhookConfig[];
    smtp: SmtpConfig;
}

export interface UserNotificationPrefs {
    _id: `team:notifications:prefs:${string}`;
    _rev?: string;
    username: string;
    email?: string;                          // user's email for SMTP notifications
    enabledEvents: NotificationEventType[];  // which events trigger notifications
    channels: {
        email: boolean;
        webhook: boolean;                    // receives via all configured team webhooks
    };
}
```

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/types.ts
git commit -m "feat(team): add notification types and CouchDB document schemas"
```

---

### Task 2: WebhookChannel

HTTP POST sender with platform-specific message formatting for Slack, Discord, Teams, and generic JSON.

**Files:**
- Create: `src/modules/features/TeamSync/WebhookChannel.ts`
- Create: `test/unit/team-phase6.test.ts`

**Step 1: Write the failing tests**

Create `test/unit/team-phase6.test.ts`:

```typescript
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
            type: "mention",
            title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice",
            targets: ["bob"],
            timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body.text).toContain("Alice mentioned you");
    });

    it("should format Discord message correctly", () => {
        const body = channel.formatPayload("discord", {
            type: "mention",
            title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice",
            targets: ["bob"],
            timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body.embeds).toBeDefined();
        expect(body.embeds[0].title).toBe("New mention");
    });

    it("should format Teams message correctly", () => {
        const body = channel.formatPayload("teams", {
            type: "mention",
            title: "New mention",
            body: "Alice mentioned you in notes/test.md",
            actor: "alice",
            targets: ["bob"],
            timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body["@type"]).toBe("MessageCard");
    });

    it("should format generic JSON payload", () => {
        const body = channel.formatPayload("generic", {
            type: "file-change",
            title: "File changed",
            body: "notes/readme.md was updated by alice",
            actor: "alice",
            targets: ["bob"],
            timestamp: "2026-02-12T10:00:00Z",
        });
        expect(body.type).toBe("file-change");
        expect(body.title).toBe("File changed");
    });

    it("should send webhook with correct headers", async () => {
        const config = { url: "https://hooks.example.com/test", platform: "generic" as const, enabled: true, label: "Test" };
        const notification = {
            type: "mention" as const,
            title: "Test",
            body: "Test body",
            actor: "alice",
            targets: ["bob"],
            timestamp: "2026-02-12T10:00:00Z",
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: FAIL — module not found

**Step 3: Write WebhookChannel**

Create `src/modules/features/TeamSync/WebhookChannel.ts`:

```typescript
import type { TeamNotification, WebhookConfig, WebhookPlatform } from "./types.ts";

export class WebhookChannel {
    formatPayload(platform: WebhookPlatform, notification: TeamNotification): Record<string, any> {
        switch (platform) {
            case "slack":
                return {
                    text: `*${notification.title}*\n${notification.body}`,
                    username: "LiveSync Team",
                };
            case "discord":
                return {
                    embeds: [{
                        title: notification.title,
                        description: notification.body,
                        color: 0x7c3aed,
                        timestamp: notification.timestamp,
                        footer: { text: `by ${notification.actor}` },
                    }],
                };
            case "teams":
                return {
                    "@type": "MessageCard",
                    "@context": "https://schema.org/extensions",
                    summary: notification.title,
                    themeColor: "7c3aed",
                    title: notification.title,
                    sections: [{
                        activityTitle: notification.actor,
                        text: notification.body,
                    }],
                };
            case "generic":
            default:
                return {
                    type: notification.type,
                    title: notification.title,
                    body: notification.body,
                    actor: notification.actor,
                    targets: notification.targets,
                    timestamp: notification.timestamp,
                    metadata: notification.metadata,
                };
        }
    }

    async send(config: WebhookConfig, notification: TeamNotification): Promise<boolean> {
        if (!config.enabled) return false;

        try {
            const payload = this.formatPayload(config.platform, notification);
            const response = await fetch(config.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: 7 PASS

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/WebhookChannel.ts test/unit/team-phase6.test.ts
git commit -m "feat(team): add WebhookChannel with Slack/Discord/Teams formatters"
```

---

### Task 3: SmtpChannel

Minimal SMTP client using Node.js `net`/`tls` modules. Supports AUTH LOGIN and plain text emails. No external dependencies.

**Files:**
- Create: `src/modules/features/TeamSync/SmtpChannel.ts`
- Modify: `test/unit/team-phase6.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/team-phase6.test.ts`:

```typescript
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
            type: "mention",
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
            { type: "mention", title: "T", body: "B", actor: "a", targets: ["b"], timestamp: "2026-02-12T10:00:00Z" },
        );
        expect(result).toBe(false);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: SmtpChannel tests FAIL

**Step 3: Write SmtpChannel**

Create `src/modules/features/TeamSync/SmtpChannel.ts`:

```typescript
import type { TeamNotification, SmtpConfig } from "./types.ts";

interface EmailContent {
    from: string;
    to: string;
    subject: string;
    body: string;
}

export class SmtpChannel {
    formatNotification(notification: TeamNotification): { subject: string; body: string } {
        return {
            subject: `[LiveSync] ${notification.title}`,
            body: [
                notification.body,
                "",
                `— ${notification.actor}, ${new Date(notification.timestamp).toLocaleString()}`,
            ].join("\r\n"),
        };
    }

    buildEmail(content: EmailContent): string {
        return [
            `From: ${content.from}`,
            `To: ${content.to}`,
            `Subject: ${content.subject}`,
            `Date: ${new Date().toUTCString()}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            content.body,
        ].join("\r\n");
    }

    async send(config: SmtpConfig, toAddress: string, notification: TeamNotification): Promise<boolean> {
        if (!config.enabled) return false;

        try {
            const { subject, body } = this.formatNotification(notification);
            const emailData = this.buildEmail({
                from: config.fromAddress,
                to: toAddress,
                subject,
                body,
            });

            return await this._sendViaSMTP(config, toAddress, emailData);
        } catch {
            return false;
        }
    }

    /** Minimal SMTP client using Node.js net/tls */
    private async _sendViaSMTP(config: SmtpConfig, toAddress: string, emailData: string): Promise<boolean> {
        // Dynamic import of Node.js modules (available in Obsidian/Electron)
        const net = require("net") as typeof import("net");
        const tls = require("tls") as typeof import("tls");

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                socket?.destroy();
                resolve(false);
            }, 15_000);

            let socket: any;
            const commands: string[] = [];
            let step = 0;

            const onData = (data: Buffer) => {
                const response = data.toString();
                const code = parseInt(response.slice(0, 3));

                if (step === 0) {
                    // Server greeting
                    if (code !== 220) { cleanup(false); return; }
                    send(`EHLO localhost`);
                    step = 1;
                } else if (step === 1) {
                    // EHLO response
                    if (code !== 250) { cleanup(false); return; }
                    if (config.username) {
                        send(`AUTH LOGIN`);
                        step = 2;
                    } else {
                        send(`MAIL FROM:<${config.fromAddress}>`);
                        step = 5;
                    }
                } else if (step === 2) {
                    // AUTH LOGIN prompt for username
                    if (code !== 334) { cleanup(false); return; }
                    send(Buffer.from(config.username).toString("base64"));
                    step = 3;
                } else if (step === 3) {
                    // AUTH LOGIN prompt for password
                    if (code !== 334) { cleanup(false); return; }
                    send(Buffer.from(config.password).toString("base64"));
                    step = 4;
                } else if (step === 4) {
                    // AUTH success
                    if (code !== 235) { cleanup(false); return; }
                    send(`MAIL FROM:<${config.fromAddress}>`);
                    step = 5;
                } else if (step === 5) {
                    // MAIL FROM accepted
                    if (code !== 250) { cleanup(false); return; }
                    send(`RCPT TO:<${toAddress}>`);
                    step = 6;
                } else if (step === 6) {
                    // RCPT TO accepted
                    if (code !== 250) { cleanup(false); return; }
                    send(`DATA`);
                    step = 7;
                } else if (step === 7) {
                    // DATA start
                    if (code !== 354) { cleanup(false); return; }
                    send(`${emailData}\r\n.`);
                    step = 8;
                } else if (step === 8) {
                    // Message accepted
                    send(`QUIT`);
                    cleanup(code === 250);
                }
            };

            const send = (cmd: string) => {
                socket?.write(cmd + "\r\n");
            };

            const cleanup = (success: boolean) => {
                clearTimeout(timeout);
                socket?.destroy();
                resolve(success);
            };

            if (config.secure) {
                socket = tls.connect(config.port, config.host, { rejectUnauthorized: false }, () => {});
            } else {
                socket = net.createConnection(config.port, config.host);
            }

            socket.on("data", onData);
            socket.on("error", () => cleanup(false));
            socket.on("timeout", () => cleanup(false));
            socket.setTimeout(15_000);
        });
    }
}
```

**Note to implementer:** The SMTP `_sendViaSMTP` method uses `require("net")` and `require("tls")` — these are available in Obsidian's Electron environment but NOT in the Vitest browser test environment. The unit tests only test `buildEmail`, `formatNotification`, and the `enabled: false` guard. Integration testing of actual SMTP sending would require a mock SMTP server, which is out of scope for unit tests.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: All tests PASS (7 webhook + 3 SMTP = 10)

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/SmtpChannel.ts test/unit/team-phase6.test.ts
git commit -m "feat(team): add SmtpChannel for email notifications via SMTP"
```

---

### Task 4: NotificationPreferencesStore

CRUD for notification config and per-user notification preferences stored in CouchDB.

**Files:**
- Create: `src/modules/features/TeamSync/NotificationStore.ts`
- Modify: `test/unit/team-phase6.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/team-phase6.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: NotificationStore tests FAIL

**Step 3: Write NotificationStore**

Create `src/modules/features/TeamSync/NotificationStore.ts`:

```typescript
import type { LiveSyncLocalDB } from "../../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import type { TeamNotificationConfig, UserNotificationPrefs } from "./types.ts";

export class NotificationStore {
    constructor(private db: LiveSyncLocalDB) {}

    async getConfig(): Promise<TeamNotificationConfig | null> {
        try {
            const doc = await this.db.localDatabase.get("team:notifications:config");
            if ((doc as any)._deleted) return null;
            return doc as unknown as TeamNotificationConfig;
        } catch {
            return null;
        }
    }

    async saveConfig(config: TeamNotificationConfig): Promise<void> {
        if (!config._rev) {
            try {
                const existing = await this.db.localDatabase.get(config._id);
                config._rev = (existing as any)._rev;
            } catch {
                // New document
            }
        }
        await this.db.localDatabase.put(config as any);
    }

    async getPrefs(username: string): Promise<UserNotificationPrefs | null> {
        try {
            const doc = await this.db.localDatabase.get(`team:notifications:prefs:${username}`);
            if ((doc as any)._deleted) return null;
            return doc as unknown as UserNotificationPrefs;
        } catch {
            return null;
        }
    }

    async savePrefs(prefs: UserNotificationPrefs): Promise<void> {
        if (!prefs._rev) {
            try {
                const existing = await this.db.localDatabase.get(prefs._id);
                prefs._rev = (existing as any)._rev;
            } catch {
                // New document
            }
        }
        await this.db.localDatabase.put(prefs as any);
    }

    async getAllPrefs(): Promise<UserNotificationPrefs[]> {
        const result = await this.db.localDatabase.allDocs({
            startkey: "team:notifications:prefs:",
            endkey: "team:notifications:prefs:\ufff0",
            include_docs: true,
        });
        return result.rows
            .map((r: any) => r.doc as UserNotificationPrefs)
            .filter((p) => p && !(p as any)._deleted);
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: All tests PASS (7 + 3 + 6 = 16)

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/NotificationStore.ts test/unit/team-phase6.test.ts
git commit -m "feat(team): add NotificationStore for config and user preferences"
```

---

### Task 5: NotificationService

Core dispatcher that receives team events, resolves target users and their preferences, and dispatches to configured channels.

**Files:**
- Create: `src/modules/features/TeamSync/NotificationService.ts`
- Modify: `test/unit/team-phase6.test.ts`

**Step 1: Write the failing tests**

Append to `test/unit/team-phase6.test.ts`:

```typescript
describe("NotificationService", () => {
    let service: any;
    let mockNotificationStore: any;
    let webhookSendCalls: any[];
    let smtpSendCalls: any[];

    beforeEach(async () => {
        const { NotificationService } = await import(
            "../../src/modules/features/TeamSync/NotificationService"
        );

        // Mock NotificationStore
        const configs = new Map<string, any>();
        const prefs = new Map<string, any>();
        mockNotificationStore = {
            getConfig: async () => configs.get("config") ?? null,
            saveConfig: async (c: any) => configs.set("config", c),
            getPrefs: async (username: string) => prefs.get(username) ?? null,
            savePrefs: async (p: any) => prefs.set(p.username, p),
        };

        // Mock channels
        webhookSendCalls = [];
        smtpSendCalls = [];
        const mockWebhookChannel = {
            send: async (config: any, notification: any) => {
                webhookSendCalls.push({ config, notification });
                return true;
            },
        };
        const mockSmtpChannel = {
            send: async (config: any, to: any, notification: any) => {
                smtpSendCalls.push({ config, to, notification });
                return true;
            },
        };

        service = new NotificationService(mockNotificationStore, mockWebhookChannel, mockSmtpChannel);
    });

    it("should not send when no config exists", async () => {
        const notification = {
            type: "mention" as const, title: "T", body: "B",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        };
        await service.dispatch(notification);
        expect(webhookSendCalls.length).toBe(0);
        expect(smtpSendCalls.length).toBe(0);
    });

    it("should send webhook when user has webhook enabled", async () => {
        await mockNotificationStore.saveConfig({
            _id: "team:notifications:config",
            webhooks: [{ url: "https://hooks.slack.com/test", platform: "slack", enabled: true, label: "Slack" }],
            smtp: { host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false },
        });
        await mockNotificationStore.savePrefs({
            _id: "team:notifications:prefs:bob",
            username: "bob",
            enabledEvents: ["mention"],
            channels: { email: false, webhook: true },
        });
        const notification = {
            type: "mention" as const, title: "Mention", body: "Alice mentioned you",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        };
        await service.dispatch(notification);
        expect(webhookSendCalls.length).toBe(1);
        expect(smtpSendCalls.length).toBe(0);
    });

    it("should send email when user has email enabled", async () => {
        await mockNotificationStore.saveConfig({
            _id: "team:notifications:config",
            webhooks: [],
            smtp: { host: "smtp.example.com", port: 587, secure: false, username: "u", password: "p", fromAddress: "team@example.com", enabled: true },
        });
        await mockNotificationStore.savePrefs({
            _id: "team:notifications:prefs:bob",
            username: "bob",
            email: "bob@example.com",
            enabledEvents: ["mention"],
            channels: { email: true, webhook: false },
        });
        const notification = {
            type: "mention" as const, title: "Mention", body: "Alice mentioned you",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        };
        await service.dispatch(notification);
        expect(smtpSendCalls.length).toBe(1);
        expect(smtpSendCalls[0].to).toBe("bob@example.com");
    });

    it("should skip user when event type not in preferences", async () => {
        await mockNotificationStore.saveConfig({
            _id: "team:notifications:config",
            webhooks: [{ url: "https://hooks.slack.com/test", platform: "slack", enabled: true, label: "Slack" }],
            smtp: { host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false },
        });
        await mockNotificationStore.savePrefs({
            _id: "team:notifications:prefs:bob",
            username: "bob",
            enabledEvents: ["file-change"], // not "mention"
            channels: { email: false, webhook: true },
        });
        const notification = {
            type: "mention" as const, title: "Mention", body: "Test",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        };
        await service.dispatch(notification);
        expect(webhookSendCalls.length).toBe(0);
    });

    it("should not notify the actor about their own action", async () => {
        await mockNotificationStore.saveConfig({
            _id: "team:notifications:config",
            webhooks: [{ url: "https://hooks.slack.com/test", platform: "slack", enabled: true, label: "Slack" }],
            smtp: { host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false },
        });
        await mockNotificationStore.savePrefs({
            _id: "team:notifications:prefs:alice",
            username: "alice",
            enabledEvents: ["mention"],
            channels: { email: false, webhook: true },
        });
        const notification = {
            type: "mention" as const, title: "Mention", body: "Test",
            actor: "alice", targets: ["alice"], timestamp: "2026-02-12T10:00:00Z",
        };
        await service.dispatch(notification);
        expect(webhookSendCalls.length).toBe(0);
    });

    it("should send to multiple webhooks", async () => {
        await mockNotificationStore.saveConfig({
            _id: "team:notifications:config",
            webhooks: [
                { url: "https://hooks.slack.com/a", platform: "slack", enabled: true, label: "A" },
                { url: "https://hooks.slack.com/b", platform: "discord", enabled: true, label: "B" },
            ],
            smtp: { host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false },
        });
        await mockNotificationStore.savePrefs({
            _id: "team:notifications:prefs:bob",
            username: "bob",
            enabledEvents: ["mention"],
            channels: { email: false, webhook: true },
        });
        const notification = {
            type: "mention" as const, title: "Mention", body: "Test",
            actor: "alice", targets: ["bob"], timestamp: "2026-02-12T10:00:00Z",
        };
        await service.dispatch(notification);
        expect(webhookSendCalls.length).toBe(2);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: NotificationService tests FAIL

**Step 3: Write NotificationService**

Create `src/modules/features/TeamSync/NotificationService.ts`:

```typescript
import type { TeamNotification } from "./types.ts";
import type { NotificationStore } from "./NotificationStore.ts";
import type { WebhookChannel } from "./WebhookChannel.ts";
import type { SmtpChannel } from "./SmtpChannel.ts";

export class NotificationService {
    constructor(
        private store: NotificationStore,
        private webhookChannel: WebhookChannel,
        private smtpChannel: SmtpChannel,
    ) {}

    async dispatch(notification: TeamNotification): Promise<void> {
        const config = await this.store.getConfig();
        if (!config) return;

        for (const target of notification.targets) {
            // Don't notify the actor about their own action
            if (target === notification.actor) continue;

            const prefs = await this.store.getPrefs(target);
            if (!prefs) continue;

            // Check if user wants this event type
            if (!prefs.enabledEvents.includes(notification.type)) continue;

            // Send via webhooks
            if (prefs.channels.webhook) {
                for (const webhook of config.webhooks) {
                    if (webhook.enabled) {
                        await this.webhookChannel.send(webhook, notification);
                    }
                }
            }

            // Send via email
            if (prefs.channels.email && config.smtp.enabled && prefs.email) {
                await this.smtpChannel.send(config.smtp, prefs.email, notification);
            }
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: All tests PASS (7 + 3 + 6 + 6 = 22)

**Step 5: Commit**

```bash
git add src/modules/features/TeamSync/NotificationService.ts test/unit/team-phase6.test.ts
git commit -m "feat(team): add NotificationService dispatcher"
```

---

### Task 6: Events + CSS

Add notification events and CSS for notification settings UI.

**Files:**
- Modify: `src/modules/features/TeamSync/events.ts`
- Modify: `styles.css`

**Step 1: Add events**

Add to `LSEvents` interface in `events.ts`:

```typescript
        "team-notification-sent": { target: string; type: string; channel: string };
        "team-notification-failed": { target: string; type: string; channel: string; error: string };
```

Add exported constants:

```typescript
export const EVENT_TEAM_NOTIFICATION_SENT = "team-notification-sent" as const;
export const EVENT_TEAM_NOTIFICATION_FAILED = "team-notification-failed" as const;
```

**Step 2: Add CSS**

Append to `styles.css`:

```css
/* ── Phase 6: Notification Settings ────────────────────── */

/* Notification config section */
.team-notification-config {
    padding: 12px 0;
}

.team-notification-config h3 {
    margin: 0 0 12px 0;
    font-size: 1em;
    font-weight: 600;
}

/* Webhook list */
.team-webhook-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
}

.team-webhook-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--background-secondary);
}

.team-webhook-item input[type="text"] {
    flex: 1;
    min-width: 0;
}

.team-webhook-item select {
    width: 100px;
}

.team-webhook-item .team-webhook-remove {
    color: var(--text-error);
    cursor: pointer;
    padding: 2px 6px;
    border: none;
    background: none;
}

/* SMTP config fields */
.team-smtp-config {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    align-items: center;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--background-secondary);
    margin-bottom: 12px;
}

.team-smtp-config label {
    font-size: 0.85em;
    color: var(--text-muted);
    text-align: right;
}

.team-smtp-config input {
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 0.85em;
}

/* User notification preferences */
.team-notification-prefs {
    padding: 12px 0;
}

.team-notification-prefs h3 {
    margin: 0 0 8px 0;
    font-size: 1em;
    font-weight: 600;
}

.team-notification-prefs-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-radius: 4px;
    background: var(--background-secondary);
    margin-bottom: 4px;
}

.team-notification-prefs-row label {
    font-size: 0.85em;
}

.team-notification-channel-toggles {
    display: flex;
    gap: 12px;
    align-items: center;
}

.team-notification-channel-toggles label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8em;
    color: var(--text-muted);
}

/* Test notification button */
.team-notification-test {
    margin-top: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
}

.team-notification-test-result {
    font-size: 0.8em;
    color: var(--text-muted);
}

.team-notification-test-result.success {
    color: var(--text-success);
}

.team-notification-test-result.error {
    color: var(--text-error);
}
```

**Step 3: Commit**

```bash
git add src/modules/features/TeamSync/events.ts styles.css
git commit -m "feat(team): add notification events and CSS styles"
```

---

### Task 7: NotificationConfigPane.svelte (Admin UI)

Admin Svelte 5 component for configuring webhook endpoints and SMTP settings.

**Files:**
- Create: `src/modules/features/TeamSync/NotificationConfigPane.svelte`

**Step 1: Write the component**

```svelte
<script lang="ts">
    import type { TeamNotificationConfig, WebhookConfig, SmtpConfig, WebhookPlatform } from "./types.ts";

    interface Props {
        getConfig: () => Promise<TeamNotificationConfig | null>;
        onSave: (config: Omit<TeamNotificationConfig, "_id" | "_rev">) => Promise<void>;
        onTest: (channel: "webhook" | "smtp", index?: number) => Promise<boolean>;
    }

    let { getConfig, onSave, onTest }: Props = $props();

    let webhooks: WebhookConfig[] = $state([]);
    let smtp: SmtpConfig = $state({
        host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false,
    });
    let saving = $state(false);
    let dirty = $state(false);
    let testResult = $state("");

    async function load() {
        const config = await getConfig();
        if (config) {
            webhooks = config.webhooks.map((w) => ({ ...w }));
            smtp = { ...config.smtp };
        }
        dirty = false;
    }

    function addWebhook() {
        webhooks = [...webhooks, { url: "", platform: "generic" as WebhookPlatform, enabled: true, label: "" }];
        dirty = true;
    }

    function removeWebhook(index: number) {
        webhooks = webhooks.filter((_, i) => i !== index);
        dirty = true;
    }

    function markDirty() {
        dirty = true;
    }

    async function save() {
        saving = true;
        try {
            await onSave({ webhooks, smtp });
            dirty = false;
        } finally {
            saving = false;
        }
    }

    async function testChannel(channel: "webhook" | "smtp", index?: number) {
        testResult = "Testing...";
        const ok = await onTest(channel, index);
        testResult = ok ? "Sent!" : "Failed";
        setTimeout(() => { testResult = ""; }, 3000);
    }

    load();
</script>

<div class="team-notification-config">
    <h3>Webhook Endpoints</h3>
    <div class="team-webhook-list">
        {#each webhooks as webhook, i (i)}
            <div class="team-webhook-item">
                <input type="text" placeholder="Label" bind:value={webhook.label} oninput={markDirty} style="width: 80px;" />
                <select bind:value={webhook.platform} onchange={markDirty}>
                    <option value="slack">Slack</option>
                    <option value="discord">Discord</option>
                    <option value="teams">Teams</option>
                    <option value="generic">Generic</option>
                </select>
                <input type="text" placeholder="Webhook URL" bind:value={webhook.url} oninput={markDirty} />
                <label><input type="checkbox" bind:checked={webhook.enabled} onchange={markDirty} /> On</label>
                <button class="team-webhook-remove" onclick={() => removeWebhook(i)} title="Remove">&times;</button>
            </div>
        {/each}
    </div>
    <button onclick={addWebhook}>+ Add Webhook</button>

    <h3 style="margin-top: 16px;">SMTP (Email)</h3>
    <div class="team-smtp-config">
        <label>Enabled</label>
        <label><input type="checkbox" bind:checked={smtp.enabled} onchange={markDirty} /></label>
        <label>Host</label>
        <input type="text" placeholder="smtp.example.com" bind:value={smtp.host} oninput={markDirty} />
        <label>Port</label>
        <input type="number" bind:value={smtp.port} oninput={markDirty} />
        <label>TLS</label>
        <label><input type="checkbox" bind:checked={smtp.secure} onchange={markDirty} /></label>
        <label>Username</label>
        <input type="text" bind:value={smtp.username} oninput={markDirty} />
        <label>Password</label>
        <input type="password" bind:value={smtp.password} oninput={markDirty} />
        <label>From</label>
        <input type="text" placeholder="team@example.com" bind:value={smtp.fromAddress} oninput={markDirty} />
    </div>

    <div class="team-notification-test">
        <button onclick={() => testChannel("smtp")}>Test Email</button>
        {#if testResult}
            <span class="team-notification-test-result" class:success={testResult === "Sent!"} class:error={testResult === "Failed"}>{testResult}</span>
        {/if}
    </div>

    {#if dirty}
        <div class="team-settings-save">
            <button class="mod-cta" onclick={save} disabled={saving}>
                {saving ? "Saving\u2026" : "Save Notification Config"}
            </button>
        </div>
    {/if}
</div>
```

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/NotificationConfigPane.svelte
git commit -m "feat(team): add admin NotificationConfigPane component"
```

---

### Task 8: NotificationPrefsPane.svelte (User Preferences)

Per-user Svelte 5 component for choosing which events trigger notifications and via which channels.

**Files:**
- Create: `src/modules/features/TeamSync/NotificationPrefsPane.svelte`

**Step 1: Write the component**

```svelte
<script lang="ts">
    import type { UserNotificationPrefs, NotificationEventType } from "./types.ts";

    interface Props {
        username: string;
        getPrefs: () => Promise<UserNotificationPrefs | null>;
        onSave: (prefs: Omit<UserNotificationPrefs, "_id" | "_rev">) => Promise<void>;
        hasSmtp: boolean;
        hasWebhooks: boolean;
    }

    let { username, getPrefs, onSave, hasSmtp, hasWebhooks }: Props = $props();

    const eventTypes: { key: NotificationEventType; label: string; description: string }[] = [
        { key: "mention", label: "Mentions", description: "When someone @mentions you in a team note" },
        { key: "annotation-reply", label: "Replies", description: "When someone replies to your team note" },
        { key: "file-change", label: "File changes", description: "When a file you've read is changed by another team member" },
        { key: "settings-push", label: "Settings push", description: "When team settings are applied to your vault" },
    ];

    let enabledEvents: Set<NotificationEventType> = $state(new Set());
    let emailEnabled = $state(false);
    let webhookEnabled = $state(false);
    let userEmail = $state("");
    let saving = $state(false);
    let dirty = $state(false);

    async function load() {
        const prefs = await getPrefs();
        if (prefs) {
            enabledEvents = new Set(prefs.enabledEvents);
            emailEnabled = prefs.channels.email;
            webhookEnabled = prefs.channels.webhook;
            userEmail = prefs.email ?? "";
        }
        dirty = false;
    }

    function toggleEvent(key: NotificationEventType) {
        if (enabledEvents.has(key)) {
            enabledEvents.delete(key);
        } else {
            enabledEvents.add(key);
        }
        enabledEvents = new Set(enabledEvents);
        dirty = true;
    }

    function markDirty() {
        dirty = true;
    }

    async function save() {
        saving = true;
        try {
            await onSave({
                username,
                email: userEmail || undefined,
                enabledEvents: [...enabledEvents],
                channels: { email: emailEnabled, webhook: webhookEnabled },
            });
            dirty = false;
        } finally {
            saving = false;
        }
    }

    load();
</script>

<div class="team-notification-prefs">
    <h3>Notification Preferences</h3>

    <div style="margin-bottom: 12px;">
        <div class="team-notification-prefs-row">
            <label>Email address</label>
            <input type="email" placeholder="your@email.com" bind:value={userEmail} oninput={markDirty} style="width: 200px;" />
        </div>
    </div>

    <div style="margin-bottom: 12px;">
        <div class="team-notification-channel-toggles" style="padding: 6px 10px;">
            {#if hasSmtp}
                <label><input type="checkbox" bind:checked={emailEnabled} onchange={markDirty} /> Email</label>
            {/if}
            {#if hasWebhooks}
                <label><input type="checkbox" bind:checked={webhookEnabled} onchange={markDirty} /> Webhook</label>
            {/if}
        </div>
    </div>

    <div>
        {#each eventTypes as evt (evt.key)}
            <div class="team-notification-prefs-row">
                <label>
                    <input
                        type="checkbox"
                        checked={enabledEvents.has(evt.key)}
                        onchange={() => toggleEvent(evt.key)}
                    />
                    {evt.label}
                    <span style="color: var(--text-muted); font-size: 0.8em; margin-left: 4px;">{evt.description}</span>
                </label>
            </div>
        {/each}
    </div>

    {#if dirty}
        <div class="team-settings-save">
            <button class="mod-cta" onclick={save} disabled={saving}>
                {saving ? "Saving\u2026" : "Save Preferences"}
            </button>
        </div>
    {/if}
</div>
```

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/NotificationPrefsPane.svelte
git commit -m "feat(team): add per-user NotificationPrefsPane component"
```

---

### Task 9: Wire into ModuleTeamSync

Connect all Phase 6 components into the module lifecycle.

**Files:**
- Modify: `src/modules/features/TeamSync/ModuleTeamSync.ts`

**What to add:**

1. **New imports:**

```typescript
import { NotificationStore } from "./NotificationStore.ts";
import { NotificationService } from "./NotificationService.ts";
import { WebhookChannel } from "./WebhookChannel.ts";
import { SmtpChannel } from "./SmtpChannel.ts";
import { EVENT_TEAM_NOTIFICATION_SENT, EVENT_TEAM_NOTIFICATION_FAILED } from "./events.ts";
```

2. **New fields:**

```typescript
notificationStore: NotificationStore | undefined;
notificationService: NotificationService | undefined;
```

3. **In `_onReady()`** — initialize notification components:

```typescript
this.notificationStore = new NotificationStore(this.localDatabase);
this.notificationService = new NotificationService(
    this.notificationStore,
    new WebhookChannel(),
    new SmtpChannel(),
);
```

4. **In `_everyOnloadStart()`** — register notification event listeners:

```typescript
// Notify on @mentions in annotations
const offAnnotationCreated = eventHub.onEvent(EVENT_TEAM_ANNOTATION_CREATED, async (annotation: any) => {
    if (!this.notificationService || !annotation?.mentions?.length) return;
    try {
        await this.notificationService.dispatch({
            type: "mention",
            title: "New mention",
            body: `${annotation.author} mentioned you: "${annotation.content.slice(0, 100)}"`,
            actor: annotation.author,
            targets: annotation.mentions,
            timestamp: annotation.timestamp ?? new Date().toISOString(),
            metadata: { filePath: annotation.filePath, annotationId: annotation._id },
        });
    } catch (e) {
        this._log(`Notification dispatch failed: ${e}`, LOG_LEVEL_INFO);
    }
});
this.plugin.register(offAnnotationCreated);

// Notify on annotation replies
const offAnnotationUpdated = eventHub.onEvent(EVENT_TEAM_ANNOTATION_UPDATED, async (annotation: any) => {
    if (!this.notificationService || !annotation?.parentId) return;
    try {
        const parent = await this.annotationStore?.getById(annotation.parentId);
        if (!parent || parent.author === annotation.author) return;
        await this.notificationService.dispatch({
            type: "annotation-reply",
            title: "New reply",
            body: `${annotation.author} replied: "${annotation.content.slice(0, 100)}"`,
            actor: annotation.author,
            targets: [parent.author],
            timestamp: annotation.timestamp ?? new Date().toISOString(),
            metadata: { filePath: annotation.filePath, annotationId: annotation._id },
        });
    } catch (e) {
        this._log(`Notification dispatch failed: ${e}`, LOG_LEVEL_INFO);
    }
});
this.plugin.register(offAnnotationUpdated);
```

5. **In `renderTeamPane()`** — mount notification config (admin) and prefs (all users):

```typescript
// Mount notification config for admins
if (this.isCurrentUserAdmin() && this.notificationStore) {
    const { default: NotificationConfigPane } = await import("./NotificationConfigPane.svelte");
    const notifContainer = containerEl.createDiv();
    const notifComponent = mount(NotificationConfigPane, {
        target: notifContainer,
        props: {
            getConfig: () => this.notificationStore!.getConfig(),
            onSave: async (partial: any) => {
                await this.notificationStore!.saveConfig({
                    _id: "team:notifications:config" as const,
                    ...partial,
                });
            },
            onTest: async (channel: string) => {
                // Send test notification
                if (!this.notificationService) return false;
                try {
                    await this.notificationService.dispatch({
                        type: "mention",
                        title: "Test Notification",
                        body: "This is a test notification from LiveSync Team.",
                        actor: this.getCurrentUsername(),
                        targets: [this.getCurrentUsername()],
                        timestamp: new Date().toISOString(),
                    });
                    return true;
                } catch { return false; }
            },
        },
    });
    // Chain cleanup
    const prev1 = (containerEl as any).__teamPaneCleanup;
    (containerEl as any).__teamPaneCleanup = () => { prev1?.(); unmount(notifComponent); };
}

// Mount notification preferences for all users
if (this.notificationStore) {
    const { default: NotificationPrefsPane } = await import("./NotificationPrefsPane.svelte");
    const prefsContainer = containerEl.createDiv();
    const config = await this.notificationStore.getConfig();
    const prefsComponent = mount(NotificationPrefsPane, {
        target: prefsContainer,
        props: {
            username: this.getCurrentUsername(),
            getPrefs: () => this.notificationStore!.getPrefs(this.getCurrentUsername()),
            onSave: async (partial: any) => {
                await this.notificationStore!.savePrefs({
                    _id: `team:notifications:prefs:${this.getCurrentUsername()}` as `team:notifications:prefs:${string}`,
                    ...partial,
                });
            },
            hasSmtp: config?.smtp?.enabled ?? false,
            hasWebhooks: (config?.webhooks?.filter((w: any) => w.enabled).length ?? 0) > 0,
        },
    });
    const prev2 = (containerEl as any).__teamPaneCleanup;
    (containerEl as any).__teamPaneCleanup = () => { prev2?.(); unmount(prefsComponent); };
}
```

**Step 2: Commit**

```bash
git add src/modules/features/TeamSync/ModuleTeamSync.ts
git commit -m "feat(team): wire notification system into ModuleTeamSync"
```

---

### Task 10: Integration Tests

End-to-end tests verifying Phase 6 components work together.

**Files:**
- Modify: `test/unit/team-phase6.test.ts`

**Step 1: Add integration tests**

Append to `test/unit/team-phase6.test.ts`:

```typescript
describe("Phase 6 Integration", () => {
    it("should export WebhookChannel with send and formatPayload", async () => {
        const { WebhookChannel } = await import(
            "../../src/modules/features/TeamSync/WebhookChannel"
        );
        expect(typeof WebhookChannel.prototype.send).toBe("function");
        expect(typeof WebhookChannel.prototype.formatPayload).toBe("function");
    });

    it("should export SmtpChannel with send, buildEmail, formatNotification", async () => {
        const { SmtpChannel } = await import(
            "../../src/modules/features/TeamSync/SmtpChannel"
        );
        expect(typeof SmtpChannel.prototype.send).toBe("function");
        expect(typeof SmtpChannel.prototype.buildEmail).toBe("function");
        expect(typeof SmtpChannel.prototype.formatNotification).toBe("function");
    });

    it("should export NotificationStore with all methods", async () => {
        const { NotificationStore } = await import(
            "../../src/modules/features/TeamSync/NotificationStore"
        );
        const methods = ["getConfig", "saveConfig", "getPrefs", "savePrefs", "getAllPrefs"];
        for (const m of methods) {
            expect(typeof NotificationStore.prototype[m]).toBe("function");
        }
    });

    it("should export NotificationService with dispatch", async () => {
        const { NotificationService } = await import(
            "../../src/modules/features/TeamSync/NotificationService"
        );
        expect(typeof NotificationService.prototype.dispatch).toBe("function");
    });

    it("should export notification events", async () => {
        const { EVENT_TEAM_NOTIFICATION_SENT, EVENT_TEAM_NOTIFICATION_FAILED } = await import(
            "../../src/modules/features/TeamSync/events"
        );
        expect(EVENT_TEAM_NOTIFICATION_SENT).toBe("team-notification-sent");
        expect(EVENT_TEAM_NOTIFICATION_FAILED).toBe("team-notification-failed");
    });

    it("should dispatch end-to-end: store config + prefs → dispatch → webhook sent", async () => {
        const { NotificationStore } = await import("../../src/modules/features/TeamSync/NotificationStore");
        const { NotificationService } = await import("../../src/modules/features/TeamSync/NotificationService");

        const mockDB = createMockDB();
        const notifStore = new NotificationStore({ localDatabase: mockDB } as any);

        await notifStore.saveConfig({
            _id: "team:notifications:config" as const,
            webhooks: [{ url: "https://hooks.slack.com/test", platform: "slack" as const, enabled: true, label: "Slack" }],
            smtp: { host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", enabled: false },
        });

        await notifStore.savePrefs({
            _id: "team:notifications:prefs:bob" as `team:notifications:prefs:${string}`,
            username: "bob",
            enabledEvents: ["mention"],
            channels: { email: false, webhook: true },
        });

        const sent: any[] = [];
        const mockWebhook = { send: async (_c: any, _n: any) => { sent.push({ _c, _n }); return true; } };
        const mockSmtp = { send: async () => false };

        const service = new NotificationService(notifStore as any, mockWebhook as any, mockSmtp as any);
        await service.dispatch({
            type: "mention",
            title: "Test",
            body: "Alice mentioned you",
            actor: "alice",
            targets: ["bob"],
            timestamp: new Date().toISOString(),
        });

        expect(sent.length).toBe(1);
    });
});
```

**Step 2: Run all tests**

Run: `npx vitest run test/unit/team-phase6.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add test/unit/team-phase6.test.ts
git commit -m "test(team): add Phase 6 integration tests"
```

---

## Summary

| Task | Description | New Files | Tests |
|------|-------------|-----------|-------|
| 1 | Notification types | — (modify types.ts) | — |
| 2 | WebhookChannel | `WebhookChannel.ts` | 7 |
| 3 | SmtpChannel | `SmtpChannel.ts` | 3 |
| 4 | NotificationStore | `NotificationStore.ts` | 6 |
| 5 | NotificationService | `NotificationService.ts` | 6 |
| 6 | Events + CSS | — (modify events.ts, styles.css) | — |
| 7 | NotificationConfigPane | `NotificationConfigPane.svelte` | — |
| 8 | NotificationPrefsPane | `NotificationPrefsPane.svelte` | — |
| 9 | Wire into Module | — (modify ModuleTeamSync.ts) | — |
| 10 | Integration Tests | — | 6 |

**Total: 4 new TS files + 2 new Svelte components + 28 tests**
