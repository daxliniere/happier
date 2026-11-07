import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { computeConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { AgentInputProviderUsageMark } from './AgentInputProviderUsageMark';
import { AgentInputChipPickerOptionSelector } from './AgentInputChipPickerOptionSelector';

// Only the native SVG boundary is replaced; picker mark and usage geometry remain real.
vi.mock('react-native-svg', () => ({
    Svg: (props: Record<string, unknown> & { children?: React.ReactNode }) => React.createElement('Svg', props, props.children),
    Circle: (props: Record<string, unknown>) => React.createElement('Circle', props),
}));

function exhaustedGauge() {
    const gauge = computeConnectedServiceQuotaGaugeViewModel({
        snapshot: { v: 1, serviceId: 'anthropic', profileId: 'work', fetchedAt: 1_000, staleAfterMs: 60_000,
            planLabel: null, accountLabel: null, meters: [
                { meterId: 'weekly', label: 'Weekly', used: 100, limit: 100, unit: 'count', utilizationPct: null,
                    resetsAt: null, status: 'ok', details: { limitCategory: 'usage_limit' } },
            ] },
        windowMode: 'most_constrained', nowMs: 2_000, formatter: connectedServiceQuotaGaugeFormatter,
    });
    if (!gauge) throw new Error('Expected a known exhausted reading');
    return gauge;
}

describe('provider picker usage mark', () => {
    it.each([false, true])('keeps the known zero reading when row unavailable is %s', async (unavailable) => {
        const screen = await renderScreen(<AgentInputProviderUsageMark
            option={{ id: 'claude', label: 'Claude', disabled: unavailable, muted: unavailable }}
            gaugesByOptionId={new Map([['claude', exhaustedGauge()]])}
        />);
        expect(screen.getTextContent()).toBe('0');
        const circles = screen.findAll((node) => String(node.type) === 'Circle');
        expect(circles).toHaveLength(2);
        expect(circles[0].props.stroke).toBe(circles[1].props.stroke);
    });
    it('leaves an unconfigured provider numberless', async () => {
        const screen = await renderScreen(<AgentInputProviderUsageMark
            option={{ id: 'gemini', label: 'Gemini', disabled: true, muted: true }} gaugesByOptionId={new Map()}
        />);
        expect(screen.getTextContent()).toBe('');
    });
    it.each(['rail', 'stacked'] as const)('keeps the usage ring inside one provider selection target (%s)', async (variant) => {
        const selectProvider = vi.fn();
        const option = { id: 'claude', label: 'Claude' };
        const screen = await renderScreen(<AgentInputChipPickerOptionSelector
            variant={variant}
            sections={[{ id: 'providers', options: [{ ...option, leadingMark: (
                <AgentInputProviderUsageMark option={option} gaugesByOptionId={new Map([['claude', exhaustedGauge()]])} />
            ) }] }]}
            focusedOptionId={null}
            selectedOptionId={null}
            onFocusOption={selectProvider}
        />);
        const targetId = variant === 'stacked'
            ? 'agent-input-chip-picker.top-selector-option:claude'
            : 'agent-input-chip-picker.option:claude';
        const target = screen.findByTestId(targetId);
        expect(target).toBeTruthy();
        expect(target?.findAll((node) => typeof node.type === 'string'
            && node.props.accessibilityRole === 'button')).toHaveLength(1);
        expect(screen.getTextContent()).toContain('0');
        await screen.pressByTestIdAsync(targetId);
        expect(selectProvider).toHaveBeenCalledExactlyOnceWith('claude');
    });
});
