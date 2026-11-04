import { t } from '@/text';
import { encodeBase64 } from '@/encryption/base64';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type AndroidFileAction = 'save' | 'open' | 'share';

type AndroidFileActionsModule = {
    saveFile: (uri: string, name: string) => Promise<{ canceled: boolean; uri?: string }>;
    beginDownload: (name: string) => Promise<{ canceled: boolean; downloadId?: string }>;
    writeDownload: (downloadId: string, contentBase64: string) => Promise<void>;
    finishDownload: (downloadId: string) => Promise<void>;
    cancelDownload: (downloadId: string) => Promise<void>;
    openFile: (uri: string, name: string) => Promise<void>;
    shareFile: (uri: string, name: string, dialogTitle?: string) => Promise<void>;
};

export type AndroidPublicDownloadSink = Readonly<{
    canceled: boolean;
    writeBytes: (bytes: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    cleanup: () => Promise<void>;
}>;

export async function createAndroidPublicDownloadSink(name: string): Promise<AndroidPublicDownloadSink> {
    const native = requireOptionalNativeModule<AndroidFileActionsModule>('HappierFileActions');
    if (!native) throw new Error(t('files.androidFileActionsUnavailable'));
    const opened = await native.beginDownload(name);
    if (opened.canceled) {
        return { canceled: true, writeBytes: async () => {}, close: async () => {}, cleanup: async () => {} };
    }
    const downloadId = opened.downloadId?.trim();
    if (!downloadId) throw new Error(t('errors.operationFailed'));
    let closed = false;
    let cleaned = false;
    return {
        canceled: false,
        writeBytes: async (bytes) => {
            if (closed || cleaned) throw new Error(t('errors.operationFailed'));
            await native.writeDownload(downloadId, encodeBase64(bytes, 'base64'));
        },
        close: async () => {
            if (closed || cleaned) return;
            await native.finishDownload(downloadId);
            closed = true;
        },
        cleanup: async () => {
            if (closed || cleaned) return;
            cleaned = true;
            await native.cancelDownload(downloadId);
        },
    };
}

export async function performAndroidFileAction(input: Readonly<{
    fileUri: string;
    name: string;
    action: AndroidFileAction;
    dialogTitle?: string;
}>): Promise<{ canceled: boolean }> {
    const native = requireOptionalNativeModule<AndroidFileActionsModule>('HappierFileActions');
    if (!native) throw new Error(t('files.androidFileActionsUnavailable'));
    if (input.action === 'save') return await native.saveFile(input.fileUri, input.name);
    if (input.action === 'open') await native.openFile(input.fileUri, input.name);
    else if (input.dialogTitle !== undefined) await native.shareFile(input.fileUri, input.name, input.dialogTitle);
    else await native.shareFile(input.fileUri, input.name);
    return { canceled: false };
}
