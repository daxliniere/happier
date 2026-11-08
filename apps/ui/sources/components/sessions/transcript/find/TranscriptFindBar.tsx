import * as React from 'react';
import { Platform, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { IconAction } from '@/components/ui/buttons/IconAction';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { ESCAPE_LAYER_PRIORITIES, useEscapeLayer } from '@/keyboard/escape';
import { shadowLevelStyle } from '@/shadowElevation';
import { t } from '@/text';

import type { TranscriptFindState } from './useTranscriptFind';

// The bar floats over the transcript, so it needs a concrete width; React Native has no rem.
const FIND_BAR_WIDTH_PX = 340;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        position: 'absolute',
        top: 8,
        right: 12,
        zIndex: 10,
        width: FIND_BAR_WIDTH_PX,
        maxWidth: '90%',
        alignItems: 'flex-end',
        gap: 4,
    },
    bar: {
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 10,
        paddingRight: 4,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        ...shadowLevelStyle(theme.colors.shadowLevels[2]),
    },
    input: {
        flex: 1,
        minWidth: 0,
        ...Typography.default('regular'),
        color: theme.colors.input.text,
        paddingVertical: 4,
        ...(Platform.select({
            web: { outlineStyle: 'none', outlineWidth: 0 },
            default: {},
        }) as object),
    },
    count: {
        ...Typography.tabular(),
        color: theme.colors.text.secondary,
        marginHorizontal: 6,
    },
    expand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    expandLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.link,
    },
}));

export type TranscriptFindExpand = Readonly<{
    /** Older history exists that the search has not loaded yet. */
    available: boolean;
    /** The whole-history load is running; pressing again cancels it. */
    loading: boolean;
    onPress: () => void;
}>;

export function TranscriptFindBar(props: Readonly<{
    query: string;
    onChangeQuery: (query: string) => void;
    find: TranscriptFindState;
    /** Increments each time Find is requested, so a repeat shortcut refocuses the field. */
    focusRequest: number;
    onClose: () => void;
    expand: TranscriptFindExpand;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const inputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);
    const { find, onClose } = props;

    React.useEffect(() => {
        inputRef.current?.focus();
    }, [props.focusRequest]);

    useEscapeLayer({
        priority: ESCAPE_LAYER_PRIORITIES.overlay,
        allowEditableTarget: true,
        onEscape: () => { onClose(); },
    });

    const handleKeyPress = React.useCallback((event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (Platform.OS !== 'web' || event.nativeEvent.key !== 'Enter') return;
        event.preventDefault();
        // Browser-style: Enter is the next (newer) match, Shift+Enter the previous (older) one.
        if ((event.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean }).shiftKey === true) {
            find.goOlder();
        } else {
            find.goNewer();
        }
    }, [find]);

    const hasQuery = props.query.trim().length > 0;
    const countLabel = !hasQuery
        ? null
        : find.activeIndex === null
            ? t('transcript.find.noResults')
            : t('transcript.find.count', { current: find.activeIndex + 1, total: find.total });
    const canStep = find.total > 0;
    const iconColor = theme.colors.text.secondary;
    const showExpand = hasQuery && (props.expand.available || props.expand.loading);

    return (
        <View style={styles.container} accessibilityRole="search" testID="transcript-find-bar">
            <View style={styles.bar}>
                <Icon name="magnifying-glass" size={16} color={iconColor} />
                <TextInput
                    ref={inputRef}
                    testID="transcript-find-input"
                    value={props.query}
                    onChangeText={props.onChangeQuery}
                    placeholder={t('transcript.find.placeholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    accessibilityLabel={t('transcript.find.inputA11y')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    selectTextOnFocus
                    submitBehavior="submit"
                    onKeyPress={handleKeyPress}
                    onSubmitEditing={Platform.OS === 'web' ? undefined : find.goNewer}
                    style={styles.input}
                />
                {countLabel ? (
                    <Text style={styles.count} accessibilityLiveRegion="polite" testID="transcript-find-count">
                        {countLabel}
                    </Text>
                ) : null}
                <IconAction
                    size="sm"
                    accessibilityLabel={t('transcript.find.olderA11y')}
                    disabled={!canStep}
                    onPress={find.goOlder}
                    testID="transcript-find-older"
                >
                    <Icon name="arrow-up" size={16} color={iconColor} />
                </IconAction>
                <IconAction
                    size="sm"
                    accessibilityLabel={t('transcript.find.newerA11y')}
                    disabled={!canStep}
                    onPress={find.goNewer}
                    testID="transcript-find-newer"
                >
                    <Icon name="arrow-down" size={16} color={iconColor} />
                </IconAction>
                <IconAction
                    size="sm"
                    accessibilityLabel={t('transcript.find.closeA11y')}
                    onPress={onClose}
                    testID="transcript-find-close"
                >
                    <Icon name="x" size={16} color={iconColor} />
                </IconAction>
            </View>
            {showExpand ? (
                <PressableSurface
                    style={styles.expand}
                    accessibilityRole="button"
                    accessibilityLabel={props.expand.loading ? t('transcript.find.expandingSearch') : t('transcript.find.expandSearch')}
                    accessibilityHint={props.expand.loading ? t('transcript.find.expandingSearchHint') : undefined}
                    onPress={props.expand.onPress}
                    testID="transcript-find-expand"
                >
                    {props.expand.loading ? <ActivitySpinner size="small" color={theme.colors.text.link} /> : null}
                    <Text style={styles.expandLabel}>
                        {props.expand.loading ? t('transcript.find.expandingSearch') : t('transcript.find.expandSearch')}
                    </Text>
                </PressableSurface>
            ) : null}
        </View>
    );
}
