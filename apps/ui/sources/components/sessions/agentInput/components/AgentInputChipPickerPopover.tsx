import React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { AgentInputSelectionPopover } from '@/components/sessions/agentInput/selection/AgentInputSelectionPopover';

import { AgentInputChipPickerSurface } from './AgentInputChipPickerSurface';
import type { AgentInputChipPickerOption } from './AgentInputChipPickerPanel';
import { agentInputChipPickerHasDetailPane } from './AgentInputChipPickerTypes';

const DONE_ROW_HEIGHT = 44;

export type AgentInputChipPickerPopoverProps = Readonly<{
    open: boolean;
    anchorRef: React.RefObject<any>;
    boundaryRef?: React.RefObject<any> | null;
    title: string;
    showCloseButton?: boolean;
    options: ReadonlyArray<AgentInputChipPickerOption>;
    selectedOptionId?: string | null;
    onSelect: (id: string) => void;
    onRequestClose: () => void;
    applyLabel?: string;
    railWidth?: number;
    railMaxWidth?: number | `${number}%`;
    detailPaneHeaderAccessory?: React.ReactNode;
    maxHeightCap?: number;
    maxWidthCap?: number;
}>;

export function AgentInputChipPickerPopover(props: AgentInputChipPickerPopoverProps) {
    const styles = stylesheet;
    const showDoneButton = agentInputChipPickerHasDetailPane(props.options);
    const [doneRowHeight, setDoneRowHeight] = React.useState(DONE_ROW_HEIGHT);
    return (
        <AgentInputSelectionPopover
            open={props.open}
            anchorRef={props.anchorRef}
            boundaryRef={props.boundaryRef}
            maxHeightCap={props.maxHeightCap ?? 420}
            maxWidthCap={props.maxWidthCap ?? 720}
            onRequestClose={props.onRequestClose}
        >
            {({ maxHeight }) => (
                <View>
                    {showDoneButton ? (
                        <View style={styles.doneRow} onLayout={(event) => setDoneRowHeight(event.nativeEvent.layout.height)}>
                            <Pressable
                                testID="agent-input-chip-picker.done"
                                accessibilityRole="button"
                                accessibilityLabel={t('common.done')}
                                onPress={props.onRequestClose}
                                style={styles.doneButton}
                            >
                                <Text style={styles.doneLabel}>✓ {t('common.done')}</Text>
                            </Pressable>
                        </View>
                    ) : null}
                    <AgentInputChipPickerSurface
                        testID="agent-input-chip-picker-popover"
                        // Agent-input popovers shouldn't render their own header chrome; the model section
                        // already provides the relevant header (e.g. MODEL) and refresh affordance.
                        title=""
                        // Outside press / selecting options still close the popover; detailed pickers
                        // also have a persistent Done action above their scrolling content.
                        showCloseButton={props.showCloseButton ?? false}
                        options={props.options}
                        selectedOptionId={props.selectedOptionId}
                        onSelect={props.onSelect}
                        onRequestClose={props.onRequestClose}
                        applyLabel={props.applyLabel}
                        railWidth={props.railWidth}
                        railMaxWidth={props.railMaxWidth}
                        detailPaneHeaderAccessory={props.detailPaneHeaderAccessory}
                        maxHeight={showDoneButton ? Math.max(0, maxHeight - doneRowHeight) : maxHeight}
                    />
                </View>
            )}
        </AgentInputSelectionPopover>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    doneRow: {
        minHeight: DONE_ROW_HEIGHT,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 12,
        backgroundColor: theme.colors.surface.base,
    },
    doneButton: {
        minWidth: 80,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 12,
    },
    doneLabel: {
        color: theme.colors.text.primary,
        fontWeight: '600',
    },
}));
