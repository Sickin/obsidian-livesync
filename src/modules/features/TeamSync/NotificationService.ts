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
            if (target === notification.actor) continue;

            const prefs = await this.store.getPrefs(target);
            if (!prefs) continue;

            if (!prefs.enabledEvents.includes(notification.type)) continue;

            if (prefs.channels.webhook) {
                for (const webhook of config.webhooks) {
                    if (webhook.enabled) {
                        await this.webhookChannel.send(webhook, notification);
                    }
                }
            }

            if (prefs.channels.email && config.smtp.enabled && prefs.email) {
                await this.smtpChannel.send(config.smtp, prefs.email, notification);
            }
        }
    }
}
