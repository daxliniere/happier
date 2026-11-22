import { describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';

import { checkTargetConnectedServicesReady } from './checkTargetConnectedServicesReady';

const credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32) } } as unknown as Credentials;
const claude = { kind: 'builtInAgent', agentId: 'claude' } as const;

const profileBinding = (profileId: string) => ({
  v: 1 as const,
  bindingsByServiceId: {
    'claude-subscription': { source: 'connected' as const, selection: 'profile' as const, profileId },
  },
});

function api(profiles: ReadonlyArray<{ profileId: string; status: string }> | Error) {
  return {
    listConnectedServiceProfiles: vi.fn(async () => {
      if (profiles instanceof Error) throw profiles;
      return { serviceId: 'claude-subscription', profiles };
    }),
  };
}

const check = (overrides: Partial<Parameters<typeof checkTargetConnectedServicesReady>[0]> & { client: ReturnType<typeof api>; defaults?: unknown }) =>
  checkTargetConnectedServicesReady({
    credentials,
    targetBackendTarget: claude,
    explicitConnectedServices: overrides.explicitConnectedServices,
    deps: {
      createApi: async () => overrides.client,
      resolveDefaults: async () => (overrides.defaults === undefined ? null : { connectedServices: overrides.defaults as never }),
    },
  });

describe('checkTargetConnectedServicesReady', () => {
  it('is ready when the target has no connected-account binding at all', async () => {
    await expect(check({ client: api([]) })).resolves.toEqual({ ready: true });
  });

  it('is ready when the bound account exists and is healthy', async () => {
    await expect(check({ client: api([{ profileId: 'Claude2', status: 'connected' }]), defaults: profileBinding('Claude2') }))
      .resolves.toEqual({ ready: true });
  });

  it('is not ready when the account default needs to be reconnected, so the source is never stopped for it', async () => {
    await expect(check({ client: api([{ profileId: 'Claude2', status: 'needs_reauth' }]), defaults: profileBinding('Claude2') }))
      .resolves.toEqual({ ready: false, serviceId: 'claude-subscription', profileId: 'Claude2', reason: 'needs_reauth' });
  });

  it('is not ready when the bound account no longer exists', async () => {
    await expect(check({ client: api([{ profileId: 'Claude2', status: 'connected' }]), defaults: profileBinding('Claude-2') }))
      .resolves.toEqual({ ready: false, serviceId: 'claude-subscription', profileId: 'Claude-2', reason: 'profile_missing' });
  });

  it('judges the account the owner explicitly chose, not the default it replaced', async () => {
    const client = api([{ profileId: 'Claude1', status: 'connected' }, { profileId: 'Claude2', status: 'needs_reauth' }]);

    await expect(check({ client, explicitConnectedServices: profileBinding('Claude1'), defaults: profileBinding('Claude2') }))
      .resolves.toEqual({ ready: true });
  });

  it('is ready when the owner explicitly chose native auth, whatever the default is', async () => {
    const native = { v: 1 as const, bindingsByServiceId: { 'claude-subscription': { source: 'native' as const } } };

    await expect(check({
      client: api([{ profileId: 'Claude2', status: 'needs_reauth' }]),
      explicitConnectedServices: native,
      defaults: profileBinding('Claude2'),
    })).resolves.toEqual({ ready: true });
  });

  it('does not block on a profile list it cannot read', async () => {
    await expect(check({ client: api(new Error('offline')), defaults: profileBinding('Claude2') }))
      .resolves.toEqual({ ready: true });
  });

  it('leaves pool bindings to the pool logic', async () => {
    const pool = { v: 1 as const, bindingsByServiceId: { 'claude-subscription': { source: 'connected' as const, selection: 'group' as const, groupId: 'pool' } } };

    await expect(check({ client: api([]), defaults: pool })).resolves.toEqual({ ready: true });
  });
});
