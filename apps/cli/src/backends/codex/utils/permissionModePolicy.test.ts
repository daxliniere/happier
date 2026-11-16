import { describe, expect, it } from 'vitest';

import type { PermissionMode } from '@/api/types';

import {
  resolveCodexAppServerPolicyForPermissionMode,
  resolveCodexMcpPolicyForPermissionMode,
} from './permissionModePolicy';

describe('resolveCodexMcpPolicyForPermissionMode', () => {
  it.each([
    ['default', { approvalPolicy: 'untrusted', sandbox: 'workspace-write' }],
    ['read-only', { approvalPolicy: 'never', sandbox: 'read-only' }],
    ['safe-yolo', { approvalPolicy: 'never', sandbox: 'workspace-write' }],
    ['yolo', { approvalPolicy: 'never', sandbox: 'danger-full-access' }],
    ['bypassPermissions', { approvalPolicy: 'never', sandbox: 'danger-full-access' }],
    ['acceptEdits', { approvalPolicy: 'never', sandbox: 'workspace-write' }],
    ['plan', { approvalPolicy: 'untrusted', sandbox: 'workspace-write' }],
  ] satisfies Array<[PermissionMode, { approvalPolicy: string; sandbox: string }]>)(
    'maps %s to expected policy and sandbox',
    (permissionMode, expected) => {
      expect(resolveCodexMcpPolicyForPermissionMode(permissionMode)).toEqual(expected);
    },
  );
});

describe('resolveCodexAppServerPolicyForPermissionMode', () => {
  it.each([
    ['default', { approvalPolicy: { granular: { mcp_elicitations: true, request_permissions: true, rules: true, sandbox_approval: true, skill_approval: false } }, approvalsReviewer: 'user', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['__DIR__'], readOnlyAccess: { type: 'fullAccess' }, networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }],
    ['read-only', { approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' }, networkAccess: false } }],
    ['safe-yolo', { approvalPolicy: { granular: { mcp_elicitations: true, request_permissions: true, rules: true, sandbox_approval: true, skill_approval: false } }, approvalsReviewer: 'auto_review', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['__DIR__'], readOnlyAccess: { type: 'fullAccess' }, networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }],
    // YOLO stays unsandboxed with no routine approvals, but Codex rules that say "prompt" still reach the user.
    ['yolo', { approvalPolicy: { granular: { mcp_elicitations: true, request_permissions: false, rules: true, sandbox_approval: false, skill_approval: false } }, approvalsReviewer: 'user', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } }],
    ['bypassPermissions', { approvalPolicy: { granular: { mcp_elicitations: true, request_permissions: false, rules: true, sandbox_approval: false, skill_approval: false } }, approvalsReviewer: 'user', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } }],
    ['acceptEdits', { approvalPolicy: { granular: { mcp_elicitations: true, request_permissions: true, rules: true, sandbox_approval: true, skill_approval: false } }, approvalsReviewer: 'auto_review', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['__DIR__'], readOnlyAccess: { type: 'fullAccess' }, networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }],
    ['plan', { approvalPolicy: { granular: { mcp_elicitations: true, request_permissions: true, rules: true, sandbox_approval: true, skill_approval: false } }, approvalsReviewer: 'user', sandbox: 'workspace-write', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['__DIR__'], readOnlyAccess: { type: 'fullAccess' }, networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }],
  ] satisfies Array<[
    PermissionMode,
    { approvalPolicy: unknown; approvalsReviewer?: string; sandbox: string; sandboxPolicy: Record<string, unknown> }
  ]>)('maps %s to expected app-server policy', (permissionMode, expected) => {
    expect(resolveCodexAppServerPolicyForPermissionMode(permissionMode, { directory: '__DIR__' })).toEqual(expected);
  });

  it('keeps yolo on never when managed policy rejects granular approvals', () => {
    expect(resolveCodexAppServerPolicyForPermissionMode('yolo', {
      directory: '__DIR__',
      managedScalarFallback: true,
    })).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } });
  });

  it('falls safe-yolo back to user approvals when auto-review is unavailable', () => {
    expect(resolveCodexAppServerPolicyForPermissionMode('safe-yolo', {
      directory: '__DIR__',
      autoReviewAvailable: false,
    })).toMatchObject({
      approvalPolicy: {
        granular: {
          request_permissions: true,
          sandbox_approval: true,
        },
      },
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    });
  });
});
