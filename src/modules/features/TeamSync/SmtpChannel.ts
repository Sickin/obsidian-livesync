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

    private _sanitizeAddress(address: string): string {
        return address.replace(/[\r\n>]/g, "");
    }

    async send(config: SmtpConfig, toAddress: string, notification: TeamNotification): Promise<boolean> {
        if (!config.enabled) return false;

        try {
            const safeTo = this._sanitizeAddress(toAddress);
            const safeFrom = this._sanitizeAddress(config.fromAddress);
            const { subject, body } = this.formatNotification(notification);
            const emailData = this.buildEmail({
                from: safeFrom,
                to: safeTo,
                subject,
                body,
            });

            return await this._sendViaSMTP(config, safeTo, emailData);
        } catch {
            return false;
        }
    }

    private async _sendViaSMTP(config: SmtpConfig, toAddress: string, emailData: string): Promise<boolean> {
        const net = require("net") as typeof import("net");
        const tls = require("tls") as typeof import("tls");

        return new Promise((resolve) => {
            let done = false;

            const finish = (success: boolean) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                socket?.destroy();
                resolve(success);
            };

            const timeout = setTimeout(() => finish(false), 15_000);

            let socket: any;
            let step = 0;

            const onData = (data: Buffer) => {
                if (done) return;
                const response = data.toString();
                const code = parseInt(response.slice(0, 3));

                // SMTP multiline responses use dash at position 3 (e.g. "250-AUTH")
                // Wait for the final line (space at position 3) before advancing
                if (step === 1 && response.charAt(3) === "-") return;

                if (step === 0) {
                    if (code !== 220) { finish(false); return; }
                    send(`EHLO localhost`);
                    step = 1;
                } else if (step === 1) {
                    if (code !== 250) { finish(false); return; }
                    if (config.username) {
                        send(`AUTH LOGIN`);
                        step = 2;
                    } else {
                        send(`MAIL FROM:<${config.fromAddress}>`);
                        step = 5;
                    }
                } else if (step === 2) {
                    if (code !== 334) { finish(false); return; }
                    send(Buffer.from(config.username).toString("base64"));
                    step = 3;
                } else if (step === 3) {
                    if (code !== 334) { finish(false); return; }
                    send(Buffer.from(config.password).toString("base64"));
                    step = 4;
                } else if (step === 4) {
                    if (code !== 235) { finish(false); return; }
                    send(`MAIL FROM:<${config.fromAddress}>`);
                    step = 5;
                } else if (step === 5) {
                    if (code !== 250) { finish(false); return; }
                    send(`RCPT TO:<${toAddress}>`);
                    step = 6;
                } else if (step === 6) {
                    if (code !== 250) { finish(false); return; }
                    send(`DATA`);
                    step = 7;
                } else if (step === 7) {
                    if (code !== 354) { finish(false); return; }
                    send(`${emailData}\r\n.`);
                    step = 8;
                } else if (step === 8) {
                    send(`QUIT`);
                    finish(code === 250);
                }
            };

            const send = (cmd: string) => {
                socket?.write(cmd + "\r\n");
            };

            if (config.secure) {
                socket = tls.connect(config.port, config.host, { rejectUnauthorized: false }, () => {});
            } else {
                socket = net.createConnection(config.port, config.host);
            }

            socket.on("data", onData);
            socket.on("error", () => finish(false));
            socket.on("timeout", () => finish(false));
            socket.setTimeout(15_000);
        });
    }
}
