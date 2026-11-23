import { AccountProfileSchema } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceQuotaProfileRefForSession } from './resolveConnectedServiceQuotaProfileRefForSession';

describe('resolveConnectedServiceQuotaProfileRefForSession', () => {
    it('ignores legacy session quota refs when a native session has no connected-service binding', () => {
        expect(resolveConnectedServiceQuotaProfileRefForSession({
            agentId: 'codex',
            accountProfileConnectedServicesV2: [],
            metadata: {
                path: '/tmp/project',
                host: 'local',
                connectedServiceQuotaRefsV1: {
                    v: 1,
                    refs: [{
                        v: 1,
                        serviceId: 'openai-codex',
                        profileId: 'acct:native-codex',
                    }],
                    updatedAtMs: 1_000,
                },
            },
        })).toBeNull();
    });

    it('keeps connected-service bindings ahead of native quota refs', () => {
        expect(resolveConnectedServiceQuotaProfileRefForSession({
            agentId: 'codex',
            accountProfileConnectedServicesV2: [],
            metadata: {
                path: '/tmp/project',
                host: 'local',
                connectedServices: {
                    v: 1,
                    bindingsByServiceId: {
                        'openai-codex': {
                            source: 'connected',
                            profileId: 'connected-profile',
                        },
                    },
                },
                connectedServiceQuotaRefsV1: {
                    v: 1,
                    refs: [{
                        v: 1,
                        serviceId: 'openai-codex',
                        profileId: 'acct:native-codex',
                    }],
                    updatedAtMs: 1_000,
                },
            },
        })).toEqual({
            serviceId: 'openai-codex',
            profileId: 'connected-profile',
            provenance: 'connected_binding_profile',
        });
    });

    it('carries explicit profile credential health so quota consumers can suppress stale invalid snapshots', () => {
        const accountProfileConnectedServicesV2 = AccountProfileSchema.parse({
            id: 'acct',
            connectedServicesV2: [{
                serviceId: 'openai-codex',
                profiles: [
                    { profileId: 'connected-profile', status: 'needs_reauth', kind: 'oauth', providerEmail: 'a@b.com', expiresAt: 1 },
                ],
                groups: [],
            }],
        }).connectedServicesV2;

        expect(resolveConnectedServiceQuotaProfileRefForSession({
            agentId: 'codex',
            accountProfileConnectedServicesV2,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                connectedServices: {
                    v: 1,
                    bindingsByServiceId: {
                        'openai-codex': {
                            source: 'connected',
                            profileId: 'connected-profile',
                        },
                    },
                },
            },
        })).toEqual({
            serviceId: 'openai-codex',
            profileId: 'connected-profile',
            credentialHealthStatus: 'needs_reauth',
            provenance: 'connected_binding_profile',
        });
    });

    it('reports group provenance for group bindings resolved to the active member', () => {
        const accountProfileConnectedServicesV2 = AccountProfileSchema.parse({
            id: 'acct',
            connectedServicesV2: [{
                serviceId: 'openai-codex',
                profiles: [
                    { profileId: 'member-a', status: 'connected', kind: 'oauth', providerEmail: 'a@b.com', expiresAt: 1 },
                ],
                groups: [{
                    groupId: 'codex-main',
                    displayName: 'Codex main',
                    activeProfileId: 'member-a',
                    generation: 1,
                    memberProfileIds: ['member-a'],
                }],
            }],
        }).connectedServicesV2;
        expect(resolveConnectedServiceQuotaProfileRefForSession({
            agentId: 'codex',
            accountProfileConnectedServicesV2,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                connectedServices: {
                    v: 1,
                    bindingsByServiceId: {
                        'openai-codex': {
                            source: 'connected',
                            selection: 'group',
                            groupId: 'codex-main',
                        },
                    },
                },
            },
        })).toEqual({
            serviceId: 'openai-codex',
            profileId: 'member-a',
            groupId: 'codex-main',
            credentialHealthStatus: 'connected',
            provenance: 'connected_binding_group',
        });
    });

    it('resolves group provenance through retryable refresh-failure members', () => {
        const accountProfileConnectedServicesV2 = AccountProfileSchema.parse({
            id: 'acct',
            connectedServicesV2: [{
                serviceId: 'openai-codex',
                profiles: [
                    { profileId: 'member-a', status: 'refresh_failed_retryable', kind: 'oauth', providerEmail: 'a@b.com', expiresAt: 1 },
                ],
                groups: [{
                    groupId: 'codex-main',
                    displayName: 'Codex main',
                    activeProfileId: 'member-a',
                    generation: 1,
                    memberProfileIds: ['member-a'],
                }],
            }],
        }).connectedServicesV2;

        expect(resolveConnectedServiceQuotaProfileRefForSession({
            agentId: 'codex',
            accountProfileConnectedServicesV2,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                connectedServices: {
                    v: 1,
                    bindingsByServiceId: {
                        'openai-codex': {
                            source: 'connected',
                            selection: 'group',
                            groupId: 'codex-main',
                        },
                    },
                },
            },
        })).toEqual({
            serviceId: 'openai-codex',
            profileId: 'member-a',
            groupId: 'codex-main',
            credentialHealthStatus: 'refresh_failed_retryable',
            provenance: 'connected_binding_group',
        });
    });

    describe('a stored usage-limit issue that names an account', () => {
        const limitIssue = (profileId: string) => ({
            v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit', occurredAt: 10_000,
            provider: 'codex',
            usageLimit: {
                v: 1, resetAtMs: 5_000, retryAfterMs: null, quotaScope: 'account', recoverability: 'wait',
                quotaSnapshotRef: { serviceId: 'openai-codex', profileId },
            },
        }) as never;

        const singleProfileMetadata = (connectedServicesUpdatedAt?: number) => ({
            path: '/tmp/project',
            host: 'local',
            ...(connectedServicesUpdatedAt === undefined ? {} : { connectedServicesUpdatedAt }),
            connectedServices: {
                v: 1,
                bindingsByServiceId: {
                    'openai-codex': { source: 'connected', selection: 'profile', profileId: 'selected-profile' },
                },
            },
        });

        it('does not move a session off an account the owner selected after the limit was reached', () => {
            // The issue names whoever hit the limit. When the owner then sets the session to a different
            // account, the usage ring and the refresh/reset-credit actions must follow the selected
            // account, not the one the older limit belongs to. Every binding change stamps
            // connectedServicesUpdatedAt, so a binding newer than the issue is the current truth.
            expect(resolveConnectedServiceQuotaProfileRefForSession({
                agentId: 'codex',
                accountProfileConnectedServicesV2: [],
                runtimeIssue: limitIssue('exhausted-profile'),
                metadata: singleProfileMetadata(20_000),
            })).toMatchObject({
                serviceId: 'openai-codex',
                profileId: 'selected-profile',
                provenance: 'connected_binding_profile',
            });
        });

        it('still follows the account the runtime moved to when the limit is newer than the binding', () => {
            // Runtime evidence can legitimately move a session off its launch-time account (a backup
            // account took over): the limit then postdates the stored binding.
            expect(resolveConnectedServiceQuotaProfileRefForSession({
                agentId: 'codex',
                accountProfileConnectedServicesV2: [],
                runtimeIssue: limitIssue('backup-profile'),
                metadata: singleProfileMetadata(5_000),
            })).toMatchObject({
                serviceId: 'openai-codex',
                profileId: 'backup-profile',
                provenance: 'published_quota_ref',
            });
        });

        it('still follows the account a pool rotated to at runtime', () => {
            const accountProfileConnectedServicesV2 = AccountProfileSchema.parse({
                id: 'acct',
                connectedServicesV2: [{
                    serviceId: 'openai-codex',
                    profiles: [
                        { profileId: 'member-a', status: 'connected', kind: 'oauth', providerEmail: 'a@b.com', expiresAt: 1 },
                        { profileId: 'member-b', status: 'connected', kind: 'oauth', providerEmail: 'b@b.com', expiresAt: 1 },
                    ],
                    groups: [{
                        groupId: 'codex-main',
                        displayName: 'Codex main',
                        activeProfileId: 'member-a',
                        generation: 1,
                        memberProfileIds: ['member-a', 'member-b'],
                    }],
                }],
            }).connectedServicesV2;

            expect(resolveConnectedServiceQuotaProfileRefForSession({
                agentId: 'codex',
                accountProfileConnectedServicesV2,
                runtimeIssue: limitIssue('member-b'),
                metadata: {
                    path: '/tmp/project',
                    host: 'local',
                    connectedServices: {
                        v: 1,
                        bindingsByServiceId: {
                            'openai-codex': { source: 'connected', selection: 'group', groupId: 'codex-main' },
                        },
                    },
                },
            })).toEqual({
                serviceId: 'openai-codex',
                profileId: 'member-b',
                groupId: 'codex-main',
                provenance: 'published_quota_ref',
            });
        });
    });
});
