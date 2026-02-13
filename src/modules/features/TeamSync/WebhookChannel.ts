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
