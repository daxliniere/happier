import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { t } from '@/text';
import { useKeyboardCommand } from '@/keyboard/KeyboardShortcutProvider';
import { useOptionalSessionScreenTestId } from '../shell/sessionScreenTestIds';
import { resolveSessionHeaderActionTargetPx, SESSION_HEADER_ICON_SIZE_PX } from '@/components/sessions/actions/sessionHeaderIconMetrics';
import { Icon } from '@/components/ui/icons/Icon';

/**
 * Opens transcript Find from the header, beside the Activity icon. It runs the same `find.open`
 * keyboard command as the shortcut and the folded-layout menu item, so Find has one entry path.
 */
export const SessionHeaderFindButton = React.memo(() => {
    const { theme } = useUnistyles();
    const testId = useOptionalSessionScreenTestId('session-header-find-button');
    const executeKeyboardCommand = useKeyboardCommand();

    return (
        <Pressable
            testID={testId}
            onPress={() => executeKeyboardCommand('find.open')}
            style={({ pressed }) => ({
                width: resolveSessionHeaderActionTargetPx(),
                height: resolveSessionHeaderActionTargetPx(),
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
            })}
            accessibilityRole="button"
            accessibilityLabel={t('transcript.find.menuTitle')}
        >
            <Icon
                name="magnifying-glass"
                size={SESSION_HEADER_ICON_SIZE_PX}
                color={theme.colors.chrome.header.foreground}
            />
        </Pressable>
    );
});

SessionHeaderFindButton.displayName = 'SessionHeaderFindButton';
