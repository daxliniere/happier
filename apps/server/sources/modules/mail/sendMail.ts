import { createTransport, type Transporter } from "nodemailer";
import { readMailConfig } from "./mailConfig";

export interface MailMessage {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
}

let cachedTransport: { readonly smtpUrl: string; readonly transport: Transporter } | null = null;

function getTransport(smtpUrl: string): Transporter {
    if (cachedTransport?.smtpUrl !== smtpUrl) {
        cachedTransport = { smtpUrl, transport: createTransport(smtpUrl) };
    }
    return cachedTransport.transport;
}

/**
 * Sends a plain-text email through the configured SMTP server.
 * Throws when mail is not configured or the SMTP server rejects the message.
 */
export async function sendMail(message: MailMessage, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const config = readMailConfig(env);
    if (!config) {
        throw new Error("Outgoing mail is not configured (HAPPIER_SMTP_URL / HAPPIER_SMTP_FROM)");
    }
    await getTransport(config.smtpUrl).sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
    });
}
