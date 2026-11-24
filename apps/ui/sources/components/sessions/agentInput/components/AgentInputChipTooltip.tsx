import * as React from 'react';
import { Platform, View } from 'react-native';

import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';
import { t } from '@/text';

import type { AgentInputControlId } from '../controls/agentInputControlTypes';

function resolveChipTooltipLabel(controlId: AgentInputControlId): string | null {
    switch (controlId) {
        case 'engine': return t('agentInput.chipTooltips.engine');
        case 'mode': return t('agentInput.chipTooltips.mode');
        case 'goal': return t('agentInput.chipTooltips.goal');
        case 'permission': return t('agentInput.chipTooltips.permission');
        case 'actionMenu': return t('agentInput.chipTooltips.actionMenu');
        case 'profile': return t('agentInput.chipTooltips.profile');
        case 'env': return t('agentInput.chipTooltips.env');
        case 'server': return t('agentInput.chipTooltips.server');
        case 'connectedServices': return t('agentInput.chipTooltips.connectedServices');
        case 'mcp': return t('agentInput.chipTooltips.mcp');
        case 'checkout': return t('agentInput.chipTooltips.checkout');
        case 'automation': return t('agentInput.chipTooltips.automation');
        case 'stop': return t('agentInput.chipTooltips.stop');
        case 'recipient': return t('agentInput.chipTooltips.recipient');
        case 'delivery': return t('agentInput.chipTooltips.delivery');
        case 'attachments': return t('agentInput.chipTooltips.attachments');
        case 'linkedFiles': return t('agentInput.chipTooltips.linkedFiles');
        case 'files': return t('agentInput.chipTooltips.files');
        case 'reviewComments': return t('agentInput.chipTooltips.reviewComments');
        case 'storage': return t('agentInput.chipTooltips.storage');
        case 'windowsRemoteSessionMode': return t('agentInput.chipTooltips.windowsRemoteSessionMode');
        case 'providerOption': return t('agentInput.chipTooltips.providerOption');
        case 'shortcuts': return t('agentInput.chipTooltips.shortcuts');
        case 'machine': return t('agentInput.chipTooltips.machine');
        case 'path': return t('agentInput.chipTooltips.path');
        case 'resume': return t('agentInput.chipTooltips.resume');
        default: return null;
    }
}

function AgentInputChipTooltipWeb(props: Readonly<{ label: string; children: React.ReactNode }>) {
    const anchorRef = React.useRef<View>(null);
    const [activation, setActivation] = React.useState<'hover' | 'focus' | null>(null);
    // React Native Web forwards these events from the chip to its anchor View.
    const webProps = {
        onMouseEnter: () => setActivation((current) => current ?? 'hover'),
        onMouseLeave: () => setActivation((current) => current === 'hover' ? null : current),
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
            if (event.target.matches(':focus-visible')) setActivation('focus');
        },
        onBlur: () => setActivation(null),
        // Opening a picker should not leave the tooltip sitting on top of it.
        onMouseDown: () => setActivation(null),
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
            if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') setActivation(null);
        },
    } as Record<string, unknown>;
    return (
        <>
            <View ref={anchorRef} style={{ minWidth: 0, maxWidth: '100%' }} {...webProps}>
                {props.children}
            </View>
            {activation ? (
                <DeferredAnchoredTooltip activationKey="chip" anchorRef={anchorRef} label={props.label} placement="top" />
            ) : null}
        </>
    );
}

/** Tooltip on hover or keyboard focus for a composer chip on web. */
export function AgentInputChipTooltip(props: Readonly<{ controlId: AgentInputControlId; children: React.ReactNode }>) {
    if (Platform.OS !== 'web') return <>{props.children}</>;
    const label = resolveChipTooltipLabel(props.controlId);
    if (!label) return <>{props.children}</>;
    return <AgentInputChipTooltipWeb label={label}>{props.children}</AgentInputChipTooltipWeb>;
}
