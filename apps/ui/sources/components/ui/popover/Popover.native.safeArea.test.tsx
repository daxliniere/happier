import React from 'react';
import { describe, expect, it } from 'vitest';
import { Platform } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { installPopoverCommonModuleMocks } from './popoverTestHelpers';
import type { PopoverRenderProps, PopoverWindowRect } from './_types';

installPopoverCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'android', select: (value: Record<string, unknown>) => value.android ?? value.default },
            useWindowDimensions: () => ({ width: 1000, height: 800 }),
        });
    },
});

const windowFrame = { x: 0, y: 0, width: 1000, height: 800 };
const systemInsets = { top: 40, bottom: 48, left: 12, right: 20 };

async function renderGeometry(params: {
    placement?: 'top' | 'bottom' | 'left' | 'right';
    root?: PopoverWindowRect;
    frame?: PopoverWindowRect;
    insets?: typeof systemInsets | null;
    anchorY?: number;
    keyboardHeight?: number;
    rectAnchor?: boolean;
}) {
    const { Popover } = await import('./Popover');
    const { OverlayPortalProvider, OverlayPortalHost } = await import('./OverlayPortal');
    const { PopoverPortalTargetContextProvider } = await import('./PopoverPortalTarget');
    const root = params.root ?? windowFrame;
    const anchor = { x: 100, y: params.anchorY ?? 100, width: 100, height: 40 };
    // Native measurements are the system boundary; placement and boundary intersection stay real.
    const portalTarget = {
        rootRef: { current: {
            measureInWindow: (cb: (...args: number[]) => void) => cb(root.x, root.y, root.width, root.height),
        } },
        layout: { width: root.width, height: root.height },
    };
    const anchorRef = { current: {
        measureInWindow: (cb: (...args: number[]) => void) => cb(anchor.x, anchor.y, anchor.width, anchor.height),
    } };
    let observed: PopoverRenderProps | undefined;
    await renderScreen(
        <SafeAreaFrameContext.Provider value={params.frame ?? windowFrame}>
            <SafeAreaInsetsContext.Provider value={params.insets === undefined ? systemInsets : params.insets}>
                <PopoverPortalTargetContextProvider value={portalTarget}>
                    <OverlayPortalProvider>
                        <Popover
                            open
                            anchorRef={anchorRef}
                            anchor={params.rectAnchor ? { kind: 'rect', rect: {
                                left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height,
                            } } : undefined}
                            portal={{ native: true }}
                            placement={params.placement ?? 'bottom'}
                            gap={0}
                            maxHeightCap={800}
                            maxWidthCap={1000}
                            keyboardBottomInset={params.keyboardHeight ?? 0}
                            onRequestClose={() => {}}
                        >
                            {(layout) => { observed = layout; return React.createElement('PopoverChild'); }}
                        </Popover>
                        <OverlayPortalHost />
                    </OverlayPortalProvider>
                </PopoverPortalTargetContextProvider>
            </SafeAreaInsetsContext.Provider>
        </SafeAreaFrameContext.Provider>,
    );
    await flushHookEffects({ cycles: 4, turns: 10, frames: 6 });
    return observed;
}

describe.each(['android', 'ios'] as const)('Popover safe area on %s', (platform) => {
    it.each([
        { name: 'navigation bar', params: {}, maxHeight: 612, maxWidth: 968 },
        { name: 'status bar', params: { placement: 'top' as const, anchorY: 500 }, maxHeight: 460, maxWidth: 968 },
        { name: 'rect anchor', params: { rectAnchor: true }, maxHeight: 612, maxWidth: 968 },
        { name: 'already inset portal', params: { root: { x: 12, y: 40, width: 968, height: 712 } }, maxHeight: 612, maxWidth: 968 },
        { name: 'contained portal', params: { root: { x: 0, y: 200, width: 1000, height: 400 }, anchorY: 300 }, maxHeight: 260, maxWidth: 968 },
        { name: 'offset safe-area provider', params: {
            frame: { x: 0, y: 200, width: 1000, height: 400 },
            root: { x: 0, y: 200, width: 1000, height: 400 }, anchorY: 300,
            insets: { top: 20, bottom: 30, left: 0, right: 0 },
        }, maxHeight: 230, maxWidth: 1000 },
        { name: 'keyboard without counting the navigation bar twice', params: { keyboardHeight: 300 }, maxHeight: 360, maxWidth: 968 },
        { name: 'landscape side placement', params: { placement: 'right' as const }, maxHeight: 712, maxWidth: 780 },
        { name: 'missing safe-area context', params: { insets: null }, maxHeight: 660, maxWidth: 1000 },
    ])('respects $name', async ({ params, maxHeight, maxWidth }) => {
        Platform.OS = platform;
        const geometry = await renderGeometry(params);
        expect(geometry?.maxHeight).toBe(maxHeight);
        expect(geometry?.maxWidth).toBe(maxWidth);
    });
});
