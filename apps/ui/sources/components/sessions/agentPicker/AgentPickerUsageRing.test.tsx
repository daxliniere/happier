import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';

import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import { AgentPickerUsageRing } from './AgentPickerUsageRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-svg', () => ({
    Svg: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('Svg', props, props.children),
    Circle: (props: Record<string, unknown>) => React.createElement('Circle', props, null),
}));

function render(element: React.ReactElement) {
    let tree: ReturnType<typeof create> | null = null;
    act(() => {
        tree = create(element);
    });
    if (tree === null) throw new Error('AgentPickerUsageRing did not mount');
    return tree as ReturnType<typeof create>;
}

describe('AgentPickerUsageRing', () => {
    it('shows an empty number-less ring when the row has no usage gauge', () => {
        const tree = render(<AgentPickerUsageRing gauge={null} testID="rail-usage" />);
        expect(tree.root.findAllByProps({ testID: 'rail-usage' }).length).toBeGreaterThan(0);
        expect(tree.root.findAll((node) => typeof node.props.children === 'string' && node.props.children.length > 0)).toHaveLength(0);
    });

    it('shows the remaining percentage when the row has a gauge', () => {
        const gauge = {
            usedPct: 13,
            ringValueLabel: '87',
            badgeLabel: '87% left',
            usageRings: [{ meterId: 'primary', label: 'Primary', usedPct: 13, ringValueLabel: '87', valueLabel: '87% left', tone: 'ok' }],
        } as unknown as ConnectedServiceQuotaGaugeViewModel;
        const tree = render(<AgentPickerUsageRing gauge={gauge} testID="rail-usage" />);
        expect(tree.root.findAll((node) => node.props.children === '87').length).toBeGreaterThan(0);
    });
});
