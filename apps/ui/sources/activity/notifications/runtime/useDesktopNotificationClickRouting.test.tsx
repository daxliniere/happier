import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';

const routerPush = vi.hoisted(() => vi.fn());
const slot = vi.hoisted(() => ({ queue: [] as Array<string | null> }));
const invokeTauri = vi.hoisted(() => vi.fn(async (_command: string) => slot.queue.shift() ?? null));
const registration = vi.hoisted(() => ({
    wake: null as null | ((payload: unknown) => void),
    pending: null as null | { resolve: () => void; reject: (error: unknown) => void },
    unlisten: vi.fn(),
}));
const listenTauriEvent = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: routerPush } }).module;
});
vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => true,
    invokeTauri,
    listenTauriEvent,
}));

async function mountHook() {
    const { useDesktopNotificationClickRouting } = await import('./useDesktopNotificationClickRouting');
    return renderHook(() => useDesktopNotificationClickRouting());
}

describe('useDesktopNotificationClickRouting', () => {
    beforeEach(() => {
        routerPush.mockClear();
        invokeTauri.mockClear();
        registration.unlisten.mockClear();
        registration.wake = null;
        slot.queue = [];
        listenTauriEvent.mockImplementation(async (_event: string, handler: (payload: unknown) => void) => {
            registration.wake = handler;
            return registration.unlisten;
        });
    });

    it('opens a click remembered before the listener existed, once', async () => {
        slot.queue = ['session-2'];
        const hook = await mountHook();
        await flushHookEffects();

        expect(routerPush).toHaveBeenCalledTimes(1);
        expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('session-2'));
        await hook.unmount();
    });

    it('reads the slot only after listener registration settles, so a click during setup is kept', async () => {
        const registered = createDeferred<() => void>();
        listenTauriEvent.mockImplementationOnce(async () => registered.promise);
        const hook = await mountHook();
        await flushHookEffects();
        expect(invokeTauri).not.toHaveBeenCalled();

        slot.queue = ['session-3']; // clicked while registration was still pending
        registered.resolve(registration.unlisten);
        await flushHookEffects();

        expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('session-3'));
        await hook.unmount();
    });

    it('still drains the slot and warns when listener registration fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        listenTauriEvent.mockRejectedValueOnce(new Error('no event bridge'));
        slot.queue = ['session-4'];
        const hook = await mountHook();
        await flushHookEffects();

        expect(routerPush).toHaveBeenCalledWith(expect.stringContaining('session-4'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('listener unavailable'), expect.anything());
        warn.mockRestore();
        await hook.unmount();
    });

    it('opens a live click once when the event and startup read overlap, and the newest click wins', async () => {
        const hook = await mountHook();
        await flushHookEffects();
        expect(routerPush).not.toHaveBeenCalled();

        slot.queue = ['session-5'];
        registration.wake?.({ sessionId: 'session-5' });
        registration.wake?.({ sessionId: 'session-5' });
        await flushHookEffects();
        expect(routerPush).toHaveBeenCalledTimes(1);

        slot.queue = ['session-6'];
        registration.wake?.({});
        await flushHookEffects();
        expect(routerPush).toHaveBeenLastCalledWith(expect.stringContaining('session-6'));
        await hook.unmount();
    });

    it('stops listening and ignores a pending read after unmount', async () => {
        const read = createDeferred<string | null>();
        invokeTauri.mockImplementationOnce(async () => read.promise);
        const hook = await mountHook();
        await flushHookEffects();
        await hook.unmount();

        expect(registration.unlisten).toHaveBeenCalledTimes(1);
        read.resolve('session-7');
        await flushHookEffects();
        expect(routerPush).not.toHaveBeenCalled();
    });

    it('warns instead of hiding a failed pending read', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        invokeTauri.mockRejectedValueOnce(new Error('boom'));
        const hook = await mountHook();
        await flushHookEffects();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('click unavailable'), expect.anything());
        warn.mockRestore();
        await hook.unmount();
    });
});
