import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installAgentAssetLoader } from '@/dev/testkit/mocks/agentAssets';
import { renderScreen } from '@/dev/testkit';
import { computeConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { connectedServiceQuotaGaugeFormatter } from './connectedServiceQuotaGaugeFormatter';
import { ProviderUsageStripContent } from './ProviderUsageStrip';

// SVG is a native rendering boundary; the rings, panel and quota projection stay real.
vi.mock('react-native-svg', () => ({
    Svg: (props: Record<string, unknown> & { children?: React.ReactNode }) => React.createElement('Svg', props, props.children),
    SvgXml: (props: Record<string, unknown>) => React.createElement('SvgXml', props),
    Circle: (props: Record<string, unknown>) => React.createElement('Circle', props),
}));

const now = Date.parse('2026-11-01T12:00:00Z');
function gauge(serviceId: 'anthropic' | 'openai-codex', meterId: string, used: number, providerDisplayName: string) {
    const result = computeConnectedServiceQuotaGaugeViewModel({
        snapshot: {
            v: 1, serviceId, profileId: 'work', fetchedAt: now, staleAfterMs: 60_000,
            planLabel: null, accountLabel: 'Work', meters: [{
                meterId, label: meterId, used, limit: 100, unit: 'count', utilizationPct: null,
                resetsAt: now + 3_600_000, status: 'ok', details: {},
            }],
        },
        windowMode: 'most_constrained', nowMs: now, formatter: connectedServiceQuotaGaugeFormatter,
        providerDisplayName,
    });
    if (!result) throw new Error('Expected a measured usage gauge');
    return result;
}

beforeEach(async () => { await installAgentAssetLoader(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('ProviderUsageStrip', () => {
    it('opens and closes every account\'s details together from the strip', async () => {
        const screen = await renderScreen(<ProviderUsageStripContent entries={[
            { key: 'codex:default', agentId: 'codex', label: 'Codex', gauge: gauge('openai-codex', 'weekly', 100, 'Codex') },
            { key: 'claude:default', agentId: 'claude', label: 'Claude', gauge: gauge('anthropic', 'five_hour', 30, 'Claude') },
        ]} />);
        const strip = () => screen.findHostByTestId('sessions-provider-usage-strip')!;
        expect(strip().props.accessibilityRole).toBe('button');
        expect(screen.findByTestId('agent-input-provider-usage-meter:weekly')).toBeNull();
        act(() => strip().props.onPress());
        expect(screen.findByTestId('agent-input-provider-usage-meter:weekly')).toBeTruthy();
        expect(screen.findByTestId('agent-input-provider-usage-meter:five_hour')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Codex usage');
        expect(screen.getTextContent()).toContain('Claude usage');
        act(() => strip().props.onPress());
        expect(screen.findByTestId('agent-input-provider-usage-meter:weekly')).toBeNull();
    });

    it('shows each account separately, numbering them only in the opened panel', async () => {
        const screen = await renderScreen(<ProviderUsageStripContent entries={[
            { key: 'claude:anthropic/1', agentId: 'claude', label: 'Claude 1', gauge: gauge('anthropic', 'five_hour', 30, 'Claude 1') },
            { key: 'claude:anthropic/2', agentId: 'claude', label: 'Claude 2', gauge: null },
        ]} />);
        expect(screen.findByTestId('sessions-provider-usage-item:claude:anthropic/1')).toBeTruthy();
        expect(screen.findByTestId('sessions-provider-usage-item:claude:anthropic/2')).toBeTruthy();
        expect(screen.getTextContent()).not.toContain('Claude 1');
        act(() => screen.findHostByTestId('sessions-provider-usage-strip')!.props.onPress());
        expect(screen.getTextContent()).toContain('Claude 1 usage');
        expect(screen.getTextContent()).toContain('Claude 2 usage');
        expect(screen.getTextContent()).toContain('Unavailable');
    });

    it('renders nothing without any account', async () => {
        const screen = await renderScreen(<ProviderUsageStripContent entries={[]} />);
        expect(screen.findByTestId('sessions-provider-usage-strip')).toBeNull();
    });
});
