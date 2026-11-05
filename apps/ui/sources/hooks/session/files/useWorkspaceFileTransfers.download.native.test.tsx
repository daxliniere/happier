import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture, createMachineFixture, createDeferred, renderScreen } from '@/dev/testkit';
import { installSessionFilesHookCommonModuleMocks } from './sessionFilesHookTestHelpers';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const native = vi.hoisted(() => ({
    files: new Map<string, number[]>(),
    publicFiles: new Map<string, number[]>(),
    activePublicFiles: new Map<string, { name: string; bytes: number[] }>(),
    saveFile: vi.fn(), openFile: vi.fn(), shareFile: vi.fn(),
    beginDownload: vi.fn(), writeDownload: vi.fn(), finishDownload: vi.fn(), cancelDownload: vi.fn(),
    closeError: null as Error | null,
    deleteError: null as Error | null,
    rpc: vi.fn(),
    iosShare: vi.fn(), iosAvailable: vi.fn(),
    openUrl: vi.fn(),
}));

installSessionFilesHookCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ Platform: { OS: 'android' }, Linking: { openURL: native.openUrl } });
    },
    storage: async (importOriginal) => await importOriginal(),
});
vi.mock('@/sync/api/session/apiSocket', () => ({ apiSocket: { machineRPC: (...args: unknown[]) => native.rpc(...args) } }));
vi.mock('@/sync/http/client', () => ({ ServerFetchAbortedForServerSwitchError: class extends Error {}, serverFetch: async () => new Response(JSON.stringify({
    features: { machines: { enabled: true, transfer: { enabled: true, serverRouted: { enabled: true } } } },
    capabilities: {},
}), { headers: { 'Content-Type': 'application/json' } }) }));
vi.mock('expo-modules-core', async (importOriginal) => ({
    ...await importOriginal<object>(),
    requireOptionalNativeModule: (name: string) => name === 'HappierFileActions' ? native : null,
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: native.iosAvailable, shareAsync: native.iosShare }));
vi.mock('expo-file-system', () => ({
    Paths: { cache: 'file:///cache' },
    Directory: class {
        uri: string;
        constructor(...parts: Array<string | { uri: string }>) {
            this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
        }
        create() {}
    },
    File: class {
        uri: string;
        constructor(directory: { uri: string }, name: string) { this.uri = `${directory.uri}/${name}`; }
        create() {
            if (native.files.has(this.uri)) throw new Error('File already exists');
            native.files.set(this.uri, []);
        }
        open() {
            return {
                offset: 0,
                writeBytes: (bytes: Uint8Array) => native.files.get(this.uri)!.push(...bytes),
                close: () => { if (native.closeError) throw native.closeError; },
            };
        }
        delete() {
            if (native.deleteError) throw native.deleteError;
            native.files.delete(this.uri);
        }
    },
}));

import type { useWorkspaceFileTransfers } from './useWorkspaceFileTransfers';

async function setPlatform(os: 'android' | 'ios' | 'web') {
    const { Platform } = await import('react-native');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

describe('native workspace downloads through the canonical transfer pipeline', () => {
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
    beforeEach(async () => {
        const { storage } = await import('@/sync/domains/state/storage');
        storage.setState({
            sessions: { 'session-1': createSessionFixture({ id: 'session-1', active: true, metadata: { machineId: 'machine-1', path: '/workspace', host: 'test-machine' } }) },
            machines: { 'machine-1': createMachineFixture({ id: 'machine-1', active: true }) },
        });
        await setPlatform('android');
        native.openUrl.mockReset().mockResolvedValue(undefined);
        native.iosShare.mockReset().mockResolvedValue(undefined);
        native.iosAvailable.mockReset().mockResolvedValue(true);
        native.files.clear();
        native.publicFiles.clear();
        native.activePublicFiles.clear();
        native.closeError = null;
        native.deleteError = null;
        native.saveFile.mockReset().mockImplementation(async (uri: string) => {
            expect(native.files.get(uri)).toEqual([1, 2, 3, 4]);
            return { canceled: false, uri: 'content://downloads/recording.mp4' };
        });
        native.openFile.mockReset().mockResolvedValue(undefined);
        native.shareFile.mockReset().mockResolvedValue(undefined);
        native.beginDownload.mockReset().mockImplementation(async (name: string) => {
            native.activePublicFiles.set('public-download-1', { name, bytes: [] });
            return { canceled: false, downloadId: 'public-download-1' };
        });
        native.writeDownload.mockReset().mockImplementation(async (downloadId: string, contentBase64: string) => {
            native.activePublicFiles.get(downloadId)!.bytes.push(...Buffer.from(contentBase64, 'base64'));
        });
        native.finishDownload.mockReset().mockImplementation(async (downloadId: string) => {
            const file = native.activePublicFiles.get(downloadId)!;
            native.publicFiles.set(file.name, file.bytes);
            native.activePublicFiles.delete(downloadId);
        });
        native.cancelDownload.mockReset().mockImplementation(async (downloadId: string) => {
            native.activePublicFiles.delete(downloadId);
        });
        native.rpc.mockReset().mockImplementation(async (_machine: string, method: string) => {
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_URL) return { success: true, url: null };
            if (method === RPC_METHODS.STAT_FILE) return { success: true, exists: true, kind: 'file', sizeBytes: 4 };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT) return {
                success: true, downloadId: 'download-1', chunkSizeBytes: 4, sizeBytes: 4, name: 'recording.mp4',
            };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK) return {
                success: true, contentBase64: Buffer.from([1, 2, 3, 4]).toString('base64'), isLast: true,
            };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE || method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_ABORT) {
                return { success: true };
            }
            throw new Error(`Unexpected RPC ${method}`);
        });
    });

    async function mount() {
        const { useWorkspaceFileTransfers } = await import('./useWorkspaceFileTransfers');
        let api: ReturnType<typeof useWorkspaceFileTransfers> | null = null;
        function Test() { api = useWorkspaceFileTransfers({ sessionId: 'session-1' }); return null; }
        await renderScreen(<Test />);
        return () => api!;
    }

    it.each(['android', 'ios', 'web'] as const)('hands an approved Tailnet download to the browser without transferring bytes on %s', async (os) => {
        await setPlatform(os);
        if (os === 'web') vi.stubGlobal('open', native.openUrl);
        const rpc = native.rpc.getMockImplementation()!;
        const url = 'https://files.example.ts.net:9443/browse/projects/recording.mp4?download=1';
        native.rpc.mockImplementation(async (machine: string, method: string, ...args: unknown[]) => {
            if (method === 'daemon.bulkTransfer.download.url') return { success: true, url, name: 'recording.mp4' };
            return rpc(machine, method, ...args);
        });
        const api = await mount();
        await act(async () => { expect(await api().startDownload({ path: 'recording.mp4', asZip: false })).toEqual({ ok: true }); });
        if (os === 'web') expect(native.openUrl).toHaveBeenCalledWith(url, '_self', 'noopener,noreferrer');
        else expect(native.openUrl).toHaveBeenCalledWith(url);
        expect(native.rpc.mock.calls.map(call => call[1])).not.toContain(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT);
        expect(native.files.size).toBe(0);
        expect(native.beginDownload).not.toHaveBeenCalled();
        expect(api().downloadState.status).toBe('idle');
    });

    it.each([
        { success: false, error: 'Access denied' },
        { success: true, url: 'http://files.example.ts.net/browse/projects/private?download=1' },
    ])('does not open or transfer after a rejected/invalid link: %j', async response => {
        native.rpc.mockResolvedValue(response);
        const api = await mount();
        await act(async () => { expect((await api().startDownload({ path: 'private', asZip: false })).ok).toBe(false); });
        expect(native.openUrl).not.toHaveBeenCalled();
        expect(native.beginDownload).not.toHaveBeenCalled();
        expect(native.rpc.mock.calls.map(call => call[1])).not.toContain(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT);
    });

    it('reports browser handoff failure without restarting an app download', async () => {
        native.rpc.mockResolvedValue({ success: true, url: 'https://files.example.ts.net/browse/projects/file?download=1' });
        native.openUrl.mockRejectedValue(new Error('No browser available'));
        const api = await mount();
        await act(async () => { expect((await api().startDownload({ path: 'file', asZip: false })).ok).toBe(false); });
        expect(api().downloadState.status).toBe('error');
        expect(native.beginDownload).not.toHaveBeenCalled();
    });

    it('retains the released transfer path when an older daemon lacks the link method', async () => {
        const rpc = native.rpc.getMockImplementation()!;
        native.rpc.mockImplementation(async (machine: string, method: string, ...args: unknown[]) => {
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_URL) return {
                success: false, error: 'Method not found', errorCode: 'RPC_METHOD_NOT_FOUND',
            };
            return rpc(machine, method, ...args);
        });
        const api = await mount();
        await act(async () => { expect(await api().startDownload({ path: 'recording.mp4', asZip: false })).toEqual({ ok: true }); });
        expect(native.publicFiles.get('recording.mp4')).toEqual([1, 2, 3, 4]);
        expect(native.openUrl).not.toHaveBeenCalled();
    });

    it('does not hand off a link after the owner cancels the pending lookup', async () => {
        const lookup = createDeferred<{ success: true; url: string }>();
        native.rpc.mockImplementation(async () => lookup.promise);
        const api = await mount();
        let download: ReturnType<ReturnType<typeof useWorkspaceFileTransfers>['startDownload']> | undefined;
        await act(async () => { download = api().startDownload({ path: 'file', asZip: false }); });
        expect(api().downloadState.status).toBe('downloading');
        await act(async () => {
            api().cancelDownload();
            lookup.resolve({ success: true, url: 'https://files.example.ts.net/browse/projects/file?download=1' });
            expect(await download).toMatchObject({ ok: false, canceled: true });
        });
        expect(native.openUrl).not.toHaveBeenCalled();
    });

    it('streams Android Save As bytes directly into public Downloads and finalizes only after success', async () => {
        const api = await mount();
        await act(async () => { expect(await api().startDownload({ path: 'recording.mp4', asZip: false })).toEqual({ ok: true }); });
        expect(native.beginDownload).toHaveBeenCalledWith('recording.mp4');
        expect(native.writeDownload).toHaveBeenCalledWith('public-download-1', Buffer.from([1, 2, 3, 4]).toString('base64'));
        expect(native.finishDownload).toHaveBeenCalledWith('public-download-1');
        expect(native.cancelDownload).not.toHaveBeenCalled();
        expect(native.publicFiles.get('recording.mp4')).toEqual([1, 2, 3, 4]);
        expect(native.activePublicFiles.size).toBe(0);
        expect(native.saveFile).not.toHaveBeenCalled();
        expect(native.files.size).toBe(0);
        expect(api().downloadState.status).toBe('done');
        expect(native.openFile).not.toHaveBeenCalled();
        expect(native.shareFile).not.toHaveBeenCalled();
    });

    it('deletes the pending public Downloads item after a failed transfer', async () => {
        const api = await mount();
        native.rpc.mockImplementation(async (_machine: string, method: string) => {
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_URL) return { success: true, url: null };
            if (method === RPC_METHODS.STAT_FILE) return { success: true, exists: true, kind: 'file', sizeBytes: 4 };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT) return {
                success: true, downloadId: 'download-1', chunkSizeBytes: 4, sizeBytes: 4, name: 'recording.mp4',
            };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK) return { success: false, error: 'Transfer failed' };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_ABORT || method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE) return { success: true };
            throw new Error(`Unexpected RPC ${method}`);
        });
        await act(async () => { expect(await api().startDownload({ path: 'recording.mp4', asZip: false })).toEqual({ ok: false, error: 'Transfer failed' }); });
        expect(native.finishDownload).not.toHaveBeenCalled();
        expect(native.cancelDownload).toHaveBeenCalledWith('public-download-1');
        expect(native.publicFiles.size).toBe(0);
        expect(native.activePublicFiles.size).toBe(0);
    });

    it.each([true, false])('marks only app-canceled transport failures as canceled (aborted=%s)', async aborted => {
        const api = await mount();
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        const rpc = native.rpc.getMockImplementation();
        if (!rpc) throw new Error('Expected RPC boundary implementation');
        // Defer the genuine daemon init response; the transfer and cancellation owners stay real.
        native.rpc.mockImplementation(async (machine: string, method: string) => {
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT) {
                entered.resolve();
                await release.promise;
                if (!aborted) return { success: false, error: 'Download canceled' };
            }
            return await rpc(machine, method);
        });
        let download: ReturnType<ReturnType<typeof useWorkspaceFileTransfers>['startDownload']> | undefined;
        await act(async () => {
            download = api().startDownload({ path: 'recording.mp4', asZip: false });
            await Promise.race([entered.promise, download.then(result => { throw new Error(`Transfer settled before init: ${JSON.stringify(result)}`); })]);
        });
        await act(async () => {
            if (aborted) api().cancelDownload();
            release.resolve();
            expect(await download).toEqual({ ok: false, error: 'Download canceled', ...(aborted ? { canceled: true } : {}) });
        });
        expect(api().downloadState).toEqual(aborted ? { status: 'canceled' } : { status: 'error', error: 'Download canceled' });
        expect(native.files.size).toBe(0);
        expect(native.saveFile).not.toHaveBeenCalled();
    });

    it('reports destination cancellation before receiving transfer bytes', async () => {
        const api = await mount();
        native.beginDownload.mockResolvedValue({ canceled: true });
        await act(async () => { expect((await api().startDownload({ path: 'recording.mp4', asZip: false })).ok).toBe(false); });
        expect(api().downloadState.status).toBe('canceled');
        expect(native.files.size).toBe(0);
        expect(native.writeDownload).not.toHaveBeenCalled();
    });

    it('reports failed public-entry cleanup and releases the next download', async () => {
        const api = await mount();
        const rpc = native.rpc.getMockImplementation();
        if (!rpc) throw new Error('Expected RPC boundary implementation');
        native.rpc.mockImplementation(async (_machine: string, method: string) => {
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK) return { success: false, error: 'Transfer failed' };
            return await rpc(_machine, method);
        });
        native.cancelDownload.mockRejectedValueOnce(new Error('Downloads entry removal failed'));
        await act(async () => {
            expect(await api().startDownload({ path: 'recording.mp4', asZip: false }))
                .toMatchObject({ ok: false, error: expect.stringContaining('Downloads entry removal failed') });
        });
        expect(api().downloadState).toMatchObject({ status: 'error', error: expect.stringContaining('Downloads entry removal failed') });
        native.rpc.mockImplementation(rpc);
        await act(async () => {
            expect(await api().startDownload({ path: 'recording.mp4', asZip: false })).toEqual({ ok: true });
        });
        expect(api().downloadState.status).toBe('done');
    });

    it('reports failed Downloads finalization and removes the incomplete item', async () => {
        const api = await mount();
        native.finishDownload.mockRejectedValue(new Error('Destination is full'));
        await act(async () => { expect(await api().startDownload({ path: 'recording.mp4', asZip: false })).toEqual({ ok: false, error: 'Destination is full' }); });
        expect(api().downloadState).toEqual({ status: 'error', error: 'Destination is full' });
        expect(native.cancelDownload).toHaveBeenCalledWith('public-download-1');
        expect(native.publicFiles.size).toBe(0);
        expect(native.files.size).toBe(0);
    });

    it('opens or shares only when explicitly requested and keeps the granted file available', async () => {
        const api = await mount();
        for (const action of ['open', 'share'] as const) {
            await act(async () => { expect(await api().startDownload({ path: 'recording.mp4', asZip: false, action })).toEqual({ ok: true }); });
        }
        expect(native.saveFile).not.toHaveBeenCalled();
        expect(native.openFile).toHaveBeenCalledTimes(1);
        expect(native.shareFile).toHaveBeenCalledTimes(1);
        const uri = native.openFile.mock.calls[0]?.[0];
        expect(native.files.get(uri)).toEqual([1, 2, 3, 4]);
    });

    it.each(['open', 'share'] as const)('reports the completed native %s result after app cancellation during handoff', async action => {
        const api = await mount();
        let entered!: () => void;
        const actionEntered = new Promise<void>(resolve => { entered = resolve; });
        let complete!: () => void;
        const nativeAction = action === 'open' ? native.openFile : native.shareFile;
        nativeAction.mockImplementationOnce(async () => {
            entered();
            await new Promise<void>(resolve => { complete = resolve; });
            return { canceled: false };
        });
        let download: ReturnType<ReturnType<typeof useWorkspaceFileTransfers>['startDownload']> | undefined;
        await act(async () => {
            download = api().startDownload({ path: 'recording.mp4', asZip: false, action });
            await Promise.race([actionEntered, download.then(result => { throw new Error(`Transfer settled before native handoff: ${JSON.stringify(result)}`); })]);
        });
        const handoffState = api().downloadState;
        await act(async () => {
            api().cancelDownload();
            complete();
            expect(await download).toEqual({ ok: true });
        });
        expect(handoffState).toMatchObject({ status: 'downloading', cancelable: false });
        expect(api().downloadState.status).toBe('done');
        expect(native.files.get(nativeAction.mock.calls[0]?.[0])).toEqual([1, 2, 3, 4]);
    });

    it.each(['success', 'failure'] as const)('reports the iOS share %s result after app cancellation during handoff', async outcome => {
        await setPlatform('ios');
        const api = await mount();
        let entered!: () => void;
        const actionEntered = new Promise<void>(resolve => { entered = resolve; });
        let complete!: () => void;
        native.iosShare.mockImplementationOnce(async () => {
            entered();
            await new Promise<void>(resolve => { complete = resolve; });
            if (outcome === 'failure') throw new Error('Share sheet failed');
        });
        let download: ReturnType<ReturnType<typeof useWorkspaceFileTransfers>['startDownload']> | undefined;
        await act(async () => {
            download = api().startDownload({ path: 'recording.mp4', asZip: false });
            await Promise.race([actionEntered, download.then(result => { throw new Error(`Transfer settled before native handoff: ${JSON.stringify(result)}`); })]);
        });
        const handoffState = api().downloadState;
        const uri = native.iosShare.mock.calls[0]?.[0];
        expect(native.files.get(uri)).toEqual([1, 2, 3, 4]);
        await act(async () => {
            api().cancelDownload();
            complete();
            expect(await download).toEqual(outcome === 'success' ? { ok: true } : { ok: false, error: 'Share sheet failed' });
        });
        expect(handoffState).toMatchObject({ status: 'downloading', cancelable: false });
        expect(api().downloadState.status).toBe(outcome === 'success' ? 'done' : 'error');
        expect(native.files.size).toBe(0);
    });

    it('cancels before iOS handoff while sharing availability is pending', async () => {
        await setPlatform('ios');
        const api = await mount();
        let entered!: () => void;
        const availabilityEntered = new Promise<void>(resolve => { entered = resolve; });
        let complete!: () => void;
        native.iosAvailable.mockImplementationOnce(async () => {
            entered();
            await new Promise<void>(resolve => { complete = resolve; });
            return true;
        });
        let download: ReturnType<ReturnType<typeof useWorkspaceFileTransfers>['startDownload']> | undefined;
        await act(async () => {
            download = api().startDownload({ path: 'recording.mp4', asZip: false });
            await Promise.race([availabilityEntered, download.then(result => { throw new Error(`Transfer settled before sharing availability: ${JSON.stringify(result)}`); })]);
        });
        await act(async () => {
            api().cancelDownload();
            complete();
            expect(await download).toMatchObject({ ok: false, canceled: true });
        });
        expect(native.iosShare).not.toHaveBeenCalled();
        expect(native.files.size).toBe(0);
    });

    it('offers explicit Android save, open and share intents from the download control', async () => {
        const { FileDownloadButton } = await import('@/components/sessions/files/file/FileDownloadButton');
        const { DropdownMenu } = await import('@/components/ui/forms/dropdown/DropdownMenu');
        vi.useFakeTimers();
        const screen = await renderScreen(<FileDownloadButton sessionId="session-1" path="recording.mp4" testID="download-test" />);
        const trigger = screen.findByTestId('download-test');
        if (!trigger) throw new Error('Expected download control');
        await act(async () => {
            await trigger.props.onPress({ stopPropagation() {} });
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(native.saveFile).not.toHaveBeenCalled();
        const menu = screen.findByType(DropdownMenu);
        expect(menu.props.items.map((item: { id: string }) => item.id)).toEqual(['save', 'open', 'share']);
        await act(async () => { await menu.props.onSelect('open'); });
        expect(native.openFile).toHaveBeenCalledTimes(1);
        expect(native.saveFile).not.toHaveBeenCalled();
        expect(screen.findByType(DropdownMenu).props.open).toBe(false);
    });
});
