import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { canUseAppLockBiometrics } from '@/auth/appLock/appLockBiometrics';
import { APP_LOCK_AUTO_LOCK_CHOICES, type AppLockRecord } from '@/auth/appLock/appLockRecord';
import { lockAppLock, useAppLockSnapshot, verifyAppLockPassword } from '@/auth/appLock/appLockRuntime';
import {
    changeAppLockPassword,
    completeAppLockEnrollment,
    resendAppLockEnrollmentCode,
    setAppLockAutoLockMinutes,
    setAppLockBiometricEnabled,
    startAppLockEmailChange,
    startAppLockEnrollment,
    turnOffAppLock,
    type AppLockEnrollment,
} from '@/auth/appLock/appLockSetup';
import {
    describeAppLockRecoveryFailure,
    isPlausibleEmail,
    validateAppLockNewPassword,
} from '@/components/appLock/appLockMessages';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { Switch } from '@/components/ui/forms/Switch';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Modal } from '@/modal';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    form: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 24,
        gap: 14,
        width: '100%',
        maxWidth: 520,
        alignSelf: 'center',
    },
    input: {
        backgroundColor: theme.colors.input.background,
        borderColor: theme.colors.border.default,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 16,
        color: theme.colors.input.text,
        ...Typography.default(),
    },
    heading: {
        fontSize: 17,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    body: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    error: {
        fontSize: 14,
        lineHeight: 19,
        color: theme.colors.state.danger.foreground,
        ...Typography.default(),
    },
    actionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        justifyContent: 'center',
    },
}));

function describeAutoLock(minutes: number | null): string {
    if (minutes === null) return t('appLock.lockAfterLaunchOnly');
    if (minutes === 0) return t('appLock.lockAfterImmediately');
    return t('appLock.lockAfterMinutes', { count: minutes });
}

async function promptPassword(title: string, message: string): Promise<string | null> {
    const value = await Modal.prompt(title, message, { inputType: 'secure-text', confirmText: t('common.continue') });
    return value ? value : null;
}

/**
 * Settings › App lock: turns the per-device lock on (with a verified recovery email) and manages
 * it once on. Every change that weakens the lock asks for the current password.
 */
export function AppLockSettingsView() {
    const { status, record } = useAppLockSnapshot();
    const emailRecoveryAvailable = useFeatureEnabled('appLock.emailRecovery');
    return (
        <ItemList>
            {status === 'unlocked' && record ? (
                <ManageAppLock record={record} emailRecoveryAvailable={emailRecoveryAvailable} />
            ) : (
                <EnableAppLock emailRecoveryAvailable={emailRecoveryAvailable} />
            )}
        </ItemList>
    );
}

function EnableAppLock(props: Readonly<{ emailRecoveryAvailable: boolean }>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [code, setCode] = React.useState('');
    const [enrollment, setEnrollment] = React.useState<AppLockEnrollment | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    const sendCode = React.useCallback(async () => {
        if (!isPlausibleEmail(email)) {
            setError(t('appLock.invalidEmail'));
            return;
        }
        const invalid = validateAppLockNewPassword(password, confirmPassword);
        if (invalid) {
            setError(invalid);
            return;
        }
        setBusy(true);
        setError(null);
        const result = await startAppLockEnrollment({ email, password });
        setBusy(false);
        if (!result.ok) {
            setError(describeAppLockRecoveryFailure(result));
            return;
        }
        setEnrollment(result.enrollment);
    }, [confirmPassword, email, password]);

    const resend = React.useCallback(async () => {
        if (!enrollment) return;
        setError(null);
        const result = await resendAppLockEnrollmentCode(enrollment);
        if (!result.ok) setError(describeAppLockRecoveryFailure(result));
    }, [enrollment]);

    const turnOn = React.useCallback(async () => {
        if (!enrollment) return;
        setBusy(true);
        setError(null);
        const result = await completeAppLockEnrollment(enrollment, code.trim());
        setBusy(false);
        if (!result.ok) {
            setError(describeAppLockRecoveryFailure(result));
            return;
        }
        setPassword('');
        setConfirmPassword('');
        Modal.alert(t('appLock.settingsTitle'), t('appLock.turnedOn'));
    }, [code, enrollment]);

    const cancel = React.useCallback(() => {
        setEnrollment(null);
        setCode('');
        setError(null);
    }, []);

    return (
        <>
            <ItemGroup footer={t('appLock.settingsIntro')}>
                <Item
                    title={t('appLock.settingsTitle')}
                    subtitle={props.emailRecoveryAvailable ? t('appLock.settingsSubtitleOff') : t('appLock.serverUnsupported')}
                    subtitleLines={0}
                    icon={<Icon name="lock" size={29} color={theme.colors.accent.blue} />}
                    mode="info"
                    showChevron={false}
                />
            </ItemGroup>
            {props.emailRecoveryAvailable && !enrollment ? (
                <View style={styles.form}>
                    <FieldItem label={t('appLock.emailLabel')} supportingText={t('appLock.emailHint')}>
                        <TextInput
                            testID="app-lock-settings-email"
                            style={styles.input}
                            value={email}
                            onChangeText={setEmail}
                            accessibilityLabel={t('appLock.emailLabel')}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="email"
                        />
                    </FieldItem>
                    <FieldItem label={t('appLock.newPasswordLabel')}>
                        <TextInput
                            testID="app-lock-settings-password"
                            style={styles.input}
                            value={password}
                            onChangeText={setPassword}
                            accessibilityLabel={t('appLock.newPasswordLabel')}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="new-password"
                        />
                    </FieldItem>
                    <FieldItem label={t('appLock.confirmPasswordLabel')}>
                        <TextInput
                            testID="app-lock-settings-confirm"
                            style={styles.input}
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            onSubmitEditing={sendCode}
                            accessibilityLabel={t('appLock.confirmPasswordLabel')}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="new-password"
                        />
                    </FieldItem>
                    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
                    <RoundButton
                        testID="app-lock-settings-send-code"
                        title={t('appLock.sendVerificationCode')}
                        onPress={sendCode}
                        loading={busy}
                        disabled={!email || !password || !confirmPassword}
                    />
                </View>
            ) : null}
            {enrollment ? (
                <View style={styles.form}>
                    <Text style={styles.heading} accessibilityRole="header">{t('appLock.verifyTitle')}</Text>
                    <Text style={styles.body}>{t('appLock.verifyBody', { email: enrollment.email })}</Text>
                    <FieldItem label={t('appLock.codeLabel')}>
                        <TextInput
                            testID="app-lock-settings-code"
                            style={styles.input}
                            value={code}
                            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                            onSubmitEditing={turnOn}
                            accessibilityLabel={t('appLock.codeLabel')}
                            keyboardType="number-pad"
                            autoComplete="one-time-code"
                            textContentType="oneTimeCode"
                            maxLength={6}
                            autoFocus
                        />
                    </FieldItem>
                    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
                    <RoundButton
                        testID="app-lock-settings-turn-on"
                        title={t('appLock.turnOn')}
                        onPress={turnOn}
                        loading={busy}
                        disabled={code.length !== 6}
                    />
                    <View style={styles.actionsRow}>
                        <RoundButton size="small" display="inverted" title={t('appLock.resendCode')} onPress={resend} />
                        <RoundButton size="small" display="inverted" title={t('common.cancel')} onPress={cancel} />
                    </View>
                </View>
            ) : null}
        </>
    );
}

function ManageAppLock(props: Readonly<{ record: AppLockRecord; emailRecoveryAvailable: boolean }>) {
    const { theme } = useUnistyles();
    const { record } = props;
    const biometricsAvailable = canUseAppLockBiometrics();

    const changePassword = React.useCallback(async () => {
        const current = await promptPassword(t('appLock.changePassword'), t('appLock.currentPasswordPrompt'));
        if (!current) return;
        if (!(await verifyAppLockPassword(current))) {
            Modal.alert(t('common.error'), t('appLock.wrongPassword'));
            return;
        }
        const next = await promptPassword(t('appLock.changePassword'), t('appLock.newPasswordPrompt'));
        if (!next) return;
        const confirmation = await promptPassword(t('appLock.changePassword'), t('appLock.confirmPasswordPrompt'));
        if (confirmation === null) return;
        const invalid = validateAppLockNewPassword(next, confirmation);
        if (invalid) {
            Modal.alert(t('common.error'), invalid);
            return;
        }
        const changed = await changeAppLockPassword(current, next);
        Modal.alert(t('appLock.settingsTitle'), changed ? t('appLock.passwordChanged') : t('appLock.wrongPassword'));
    }, []);

    const changeEmail = React.useCallback(async () => {
        const current = await promptPassword(t('appLock.changeEmail'), t('appLock.currentPasswordPrompt'));
        if (!current) return;
        if (!(await verifyAppLockPassword(current))) {
            Modal.alert(t('common.error'), t('appLock.wrongPassword'));
            return;
        }
        const email = await Modal.prompt(t('appLock.changeEmail'), t('appLock.newEmailPrompt'), {
            inputType: 'email-address',
            defaultValue: record.email,
            confirmText: t('appLock.sendVerificationCode'),
        });
        if (!email) return;
        if (!isPlausibleEmail(email)) {
            Modal.alert(t('common.error'), t('appLock.invalidEmail'));
            return;
        }
        const started = await startAppLockEmailChange(email);
        if (!started.ok) {
            Modal.alert(t('common.error'), describeAppLockRecoveryFailure(started));
            return;
        }
        for (;;) {
            const code = await Modal.prompt(t('appLock.verifyTitle'), t('appLock.codePrompt', { email: started.enrollment.email }), {
                inputType: 'numeric',
                confirmText: t('common.continue'),
            });
            if (!code) return;
            const result = await completeAppLockEnrollment(started.enrollment, code.trim());
            if (result.ok) {
                Modal.alert(t('appLock.settingsTitle'), t('appLock.emailChanged'));
                return;
            }
            Modal.alert(t('common.error'), describeAppLockRecoveryFailure(result));
            if (result.error !== 'invalid_code') return;
        }
    }, [record.email]);

    const turnOff = React.useCallback(async () => {
        const current = await promptPassword(t('appLock.turnOff'), t('appLock.turnOffPrompt'));
        if (!current) return;
        const turnedOff = await turnOffAppLock(current);
        Modal.alert(turnedOff ? t('appLock.settingsTitle') : t('common.error'), turnedOff ? t('appLock.turnedOff') : t('appLock.wrongPassword'));
    }, []);

    const toggleFingerprint = React.useCallback(async (enabled: boolean) => {
        const ok = await setAppLockBiometricEnabled(enabled, t('appLock.fingerprintPrompt'));
        if (!ok && enabled) Modal.alert(t('common.error'), t('appLock.fingerprintFailed'));
    }, []);

    return (
        <>
            <ItemGroup footer={t('appLock.manageFooter')}>
                <Item
                    testID="app-lock-settings-lock-now"
                    title={t('appLock.lockNow')}
                    subtitle={t('appLock.settingsSubtitleOn')}
                    icon={<Icon name="lock" size={29} color={theme.colors.accent.blue} />}
                    onPress={() => lockAppLock()}
                    showChevron={false}
                />
                <Item
                    title={t('appLock.changeEmail')}
                    subtitle={record.email}
                    icon={<Icon name="envelope" size={29} color={theme.colors.accent.indigo} />}
                    onPress={props.emailRecoveryAvailable ? changeEmail : undefined}
                    disabled={!props.emailRecoveryAvailable}
                />
                <Item
                    title={t('appLock.changePassword')}
                    icon={<Icon name="key" size={29} color={theme.colors.accent.purple} />}
                    onPress={changePassword}
                />
                {biometricsAvailable ? (
                    <Item
                        title={t('appLock.fingerprintTitle')}
                        subtitle={t('appLock.fingerprintSubtitle')}
                        icon={<Icon name="fingerprint" size={29} color={theme.colors.accent.green} />}
                        rightElement={<Switch value={record.biometric} onValueChange={(value) => void toggleFingerprint(Boolean(value))} />}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
            <ItemGroup title={t('appLock.lockAfterTitle')} footer={t('appLock.lockAfterFooter')}>
                {APP_LOCK_AUTO_LOCK_CHOICES.map((minutes) => {
                    const selected = record.autoLockMinutes === minutes;
                    return (
                        <Item
                            key={String(minutes)}
                            title={describeAutoLock(minutes)}
                            selected={selected}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            rightElement={selected ? <Icon name="check" size={20} color={theme.colors.accent.blue} /> : null}
                            onPress={() => void setAppLockAutoLockMinutes(minutes)}
                            showChevron={false}
                        />
                    );
                })}
            </ItemGroup>
            <ItemGroup>
                <Item
                    testID="app-lock-settings-turn-off"
                    title={t('appLock.turnOff')}
                    icon={<Icon name="lock" size={29} color={theme.colors.state.danger.foreground} />}
                    onPress={turnOff}
                    destructive
                    showChevron={false}
                />
            </ItemGroup>
        </>
    );
}
