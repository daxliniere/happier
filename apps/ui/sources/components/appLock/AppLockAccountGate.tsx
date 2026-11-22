import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { joinAppLock, signOutLockedDevice } from '@/auth/appLock/appLockSetup';
import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';

import { APP_LOCK_MAX_PASSWORD_LENGTH, describeAppLockRecoveryFailure } from './appLockMessages';

const stylesheet = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background.canvas },
    scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
    column: { width: '100%', maxWidth: 380, alignItems: 'stretch' },
    brand: { alignItems: 'center', gap: 14, marginBottom: 28 },
    logoMark: { width: 96, height: 96 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
    title: { fontSize: 20, textAlign: 'center', color: theme.colors.text.primary, ...Typography.default('semiBold') },
    body: { fontSize: 15, lineHeight: 21, textAlign: 'center', color: theme.colors.text.secondary, marginBottom: 24, ...Typography.default() },
    input: {
        backgroundColor: theme.colors.input.background,
        borderColor: theme.colors.border.default,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: theme.colors.input.text,
        marginBottom: 14,
        ...Typography.default(),
    },
    error: { fontSize: 14, lineHeight: 19, color: theme.colors.state.danger.foreground, marginBottom: 14, ...Typography.default() },
    secondaryRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
}));

/**
 * Shown on a signed-in device that has no app lock while the account requires one. It cannot be
 * dismissed: enter the account's app lock password to turn the lock on for this device, or sign out.
 */
export function AppLockAccountGate(props: Readonly<{ onSignedOut: () => void }>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const [password, setPassword] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    const submit = React.useCallback(async () => {
        if (!password || busy) return;
        setBusy(true);
        setError(null);
        const result = await joinAppLock(password);
        setBusy(false);
        if (!result.ok) {
            setError(describeAppLockRecoveryFailure(result));
            setPassword('');
        }
    }, [busy, password]);

    const signOut = React.useCallback(async () => {
        const confirmed = await Modal.confirm(t('appLock.signOutTitle'), t('appLock.signOutBody'), {
            confirmText: t('appLock.signOutLink'),
            destructive: true,
        });
        if (!confirmed) return;
        await signOutLockedDevice();
        props.onSignedOut();
    }, [props]);

    return (
        <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="app-lock-account-gate">
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                <View style={styles.column}>
                    <View style={styles.brand} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                        <Image
                            source={theme.dark ? require('@/assets/images/logo-white.png') : require('@/assets/images/logo-black.png')}
                            contentFit="contain"
                            style={styles.logoMark}
                        />
                        <BrandWordmark height={40} />
                    </View>
                    <View style={styles.titleRow}>
                        <Icon name="lock" size={18} color={theme.colors.text.secondary} />
                        <Text style={styles.title} accessibilityRole="header">{t('appLock.gateTitle')}</Text>
                    </View>
                    <Text style={styles.body}>{t('appLock.gateBody')}</Text>
                    <TextInput
                        testID="app-lock-gate-password"
                        style={styles.input}
                        value={password}
                        onChangeText={setPassword}
                        onSubmitEditing={submit}
                        placeholder={t('appLock.passwordLabel')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        accessibilityLabel={t('appLock.passwordLabel')}
                        secureTextEntry
                        maxLength={APP_LOCK_MAX_PASSWORD_LENGTH}
                        autoFocus
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="current-password"
                        returnKeyType="go"
                    />
                    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
                    <RoundButton testID="app-lock-gate-unlock" title={t('appLock.unlock')} onPress={submit} loading={busy} disabled={!password} />
                    <View style={styles.secondaryRow}>
                        <RoundButton size="small" display="inverted" title={t('appLock.signOutLink')} onPress={signOut} />
                    </View>
                </View>
            </ScrollView>
        </View>
    );
}
