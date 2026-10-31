/**
 * Outgoing mail settings for server-sent emails (currently app-lock recovery codes).
 *
 * `HAPPIER_SMTP_URL` is a nodemailer SMTP connection URL, for example
 * `smtps://user:app-password@smtp.gmail.com:465` or `smtp://user:pass@mail.example.com:587`.
 * `HAPPIER_SMTP_FROM` is the sender, for example `Happier <me@example.com>`.
 * Mail is considered configured only when both are present and the URL uses smtp/smtps.
 */
export const MAIL_ENV_KEYS = Object.freeze({
    smtpUrl: "HAPPIER_SMTP_URL",
    from: "HAPPIER_SMTP_FROM",
});

export interface MailConfig {
    readonly smtpUrl: string;
    readonly from: string;
}

export function readMailConfig(env: NodeJS.ProcessEnv): MailConfig | null {
    const smtpUrl = (env[MAIL_ENV_KEYS.smtpUrl] ?? "").trim();
    const from = (env[MAIL_ENV_KEYS.from] ?? "").trim();
    if (!smtpUrl || !from) return null;
    try {
        const protocol = new URL(smtpUrl).protocol;
        if (protocol !== "smtp:" && protocol !== "smtps:") return null;
    } catch {
        return null;
    }
    return { smtpUrl, from };
}
