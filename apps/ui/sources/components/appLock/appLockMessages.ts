import type { AppLockRecoveryFailure } from '@/sync/api/appLock/apiAppLockRecovery';
import { t } from '@/text';

export const APP_LOCK_MIN_PASSWORD_LENGTH = 6;

/** User-facing text for a relay recovery failure. */
export function describeAppLockRecoveryFailure(failure: AppLockRecoveryFailure): string {
    switch (failure.error) {
        case 'invalid_code':
            return t('appLock.errors.invalidCode');
        case 'code_expired':
            return t('appLock.errors.codeExpired');
        case 'too_many_attempts':
            return t('appLock.errors.tooManyAttempts');
        case 'cooldown':
            return t('appLock.errors.cooldown', { seconds: failure.retryAfterSeconds ?? 60 });
        case 'not_found':
            return t('appLock.errors.notFound');
        case 'email_failed':
            return t('appLock.errors.emailFailed');
        case 'network':
            return t('appLock.errors.network');
    }
}

/** Validation message for a new password and its confirmation, or null when acceptable. */
export function validateAppLockNewPassword(password: string, confirmation: string): string | null {
    if (password.length < APP_LOCK_MIN_PASSWORD_LENGTH) return t('appLock.passwordTooShort', { min: APP_LOCK_MIN_PASSWORD_LENGTH });
    if (password !== confirmation) return t('appLock.passwordsDontMatch');
    return null;
}

export function isPlausibleEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** "owner@example.com" → "o••••@example.com", so the lock screen does not reveal the address. */
export function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    return `${local[0]}${'•'.repeat(Math.max(1, Math.min(local.length - 1, 4)))}@${domain}`;
}
