import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { readCurrentAppRuntimeInfo } from '@/sync/runtime/readCurrentAppRuntimeInfo';

const stylesheet = StyleSheet.create((theme) => ({
    label: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
}));

/**
 * The running app version, shown on the lock screen so a locked device can be identified without
 * unlocking it. Same source as the version in Settings › About.
 */
export const AppLockVersionLabel = React.memo(function AppLockVersionLabel() {
    const version = readCurrentAppRuntimeInfo().appVersion;
    if (!version) return null;
    return <Text testID="app-lock-version" style={stylesheet.label}>{version}</Text>;
});
