import * as React from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { useSessionListStorageKind } from '@/components/sessions/model/useSessionListStorageKind';
import { t } from '@/text';

const styles = StyleSheet.create(() => ({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonPressed: {
        opacity: 0.68,
        transform: [{ scale: 0.96 }],
    },
}));

/** Header icon that opens provider-session browsing; renders nothing while direct sessions are off. */
export const DirectSessionsBrowseButton = React.memo(function DirectSessionsBrowseButton(props: Readonly<{
    buttonSize: number;
    iconSize: number;
    testID?: string;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { directSessionsEnabled } = useSessionListStorageKind();
    const handlePress = React.useCallback(() => {
        router.push('/direct/browse');
    }, [router]);

    if (!directSessionsEnabled) return null;

    return (
        <Pressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={t('directSessions.browseOpenExisting')}
            hitSlop={8}
            onPress={handlePress}
            style={({ pressed }) => [
                styles.button,
                {
                    width: props.buttonSize,
                    height: props.buttonSize,
                    borderRadius: props.buttonSize / 2,
                },
                pressed ? styles.buttonPressed : null,
            ]}
        >
            <Icon
                name="folder-open"
                size={props.iconSize}
                color={theme.colors.chrome.header.foreground}
            />
        </Pressable>
    );
});
