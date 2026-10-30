import { describe, expect, it } from 'vitest';

import { DesktopPathMappingsSchema, resolveSessionLocalFilePath } from './localFilePath';

const CT100_TO_SHARE = { remotePath: '/GGGG/projects', localPath: '\\\\GGGG\\GGGG\\PROJECTS' };

describe('resolveSessionLocalFilePath', () => {
    it('joins the workspace and file path when the session runs on this computer', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/home/dax/proj',
            homeDir: '/home/dax',
            relativePath: 'docs/readme.md',
            sessionOnThisComputer: true,
            mappings: [],
        })).toBe('/home/dax/proj/docs/readme.md');
    });

    it('keeps Windows separators for a Windows workspace on this computer', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: 'C:\\Users\\dax\\proj\\',
            homeDir: 'C:\\Users\\dax',
            relativePath: 'docs/readme.md',
            sessionOnThisComputer: true,
            mappings: [],
        })).toBe('C:\\Users\\dax\\proj\\docs\\readme.md');
    });

    it('expands a home-relative workspace with the machine home directory', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '~/proj',
            homeDir: '/Users/dax',
            relativePath: 'a.md',
            sessionOnThisComputer: true,
            mappings: [],
        })).toBe('/Users/dax/proj/a.md');
    });

    it('returns null when a home-relative workspace cannot be expanded', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '~/proj',
            homeDir: null,
            relativePath: 'a.md',
            sessionOnThisComputer: true,
            mappings: [],
        })).toBeNull();
    });

    it('maps a file on another machine onto the shared folder of this computer', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/GGGG/projects/CONCIERGE/HAPPIER',
            homeDir: '/home/concierge',
            relativePath: 'notes/MY-ISSUES.md',
            sessionOnThisComputer: false,
            mappings: [CT100_TO_SHARE],
        })).toBe('\\\\GGGG\\GGGG\\PROJECTS\\CONCIERGE\\HAPPIER\\notes\\MY-ISSUES.md');
    });

    it('maps onto a POSIX folder with forward slashes', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/srv/work/app',
            homeDir: null,
            relativePath: 'a.md',
            sessionOnThisComputer: false,
            mappings: [{ remotePath: '/srv/work/', localPath: '/Volumes/work/' }],
        })).toBe('/Volumes/work/app/a.md');
    });

    it('does not match a sibling folder that only shares a name prefix', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/GGGG/projects-old/app',
            homeDir: null,
            relativePath: 'a.md',
            sessionOnThisComputer: false,
            mappings: [CT100_TO_SHARE],
        })).toBeNull();
    });

    it('uses the most specific mapping when several match', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/GGGG/projects/CONCIERGE/app',
            homeDir: null,
            relativePath: 'a.md',
            sessionOnThisComputer: false,
            mappings: [CT100_TO_SHARE, { remotePath: '/GGGG/projects/CONCIERGE', localPath: 'D:\\concierge' }],
        })).toBe('D:\\concierge\\app\\a.md');
    });

    it('maps the mapped folder itself', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/GGGG/projects',
            homeDir: null,
            relativePath: 'top.md',
            sessionOnThisComputer: false,
            mappings: [CT100_TO_SHARE],
        })).toBe('\\\\GGGG\\GGGG\\PROJECTS\\top.md');
    });

    it('returns null for a file on another machine with no matching mapping', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: '/home/concierge/app',
            homeDir: '/home/concierge',
            relativePath: 'a.md',
            sessionOnThisComputer: false,
            mappings: [CT100_TO_SHARE],
        })).toBeNull();
    });

    it('returns null without a workspace path', () => {
        expect(resolveSessionLocalFilePath({
            workspacePath: null,
            homeDir: null,
            relativePath: 'a.md',
            sessionOnThisComputer: true,
            mappings: [],
        })).toBeNull();
    });
});

describe('DesktopPathMappingsSchema', () => {
    it('drops malformed stored entries instead of discarding every mapping', () => {
        expect(DesktopPathMappingsSchema.parse([
            CT100_TO_SHARE,
            { remotePath: '', localPath: 'x' },
            'junk',
        ])).toEqual([CT100_TO_SHARE]);
    });
});

it('matches Windows source mappings without case sensitivity', () => {
    expect(resolveSessionLocalFilePath({
        workspacePath: 'C:/Work/app',
        homeDir: null,
        relativePath: 'a.md',
        sessionOnThisComputer: false,
        mappings: [{ remotePath: 'c:/work', localPath: '/mnt/shared' }],
    })).toBe('/mnt/shared/app/a.md');
});
