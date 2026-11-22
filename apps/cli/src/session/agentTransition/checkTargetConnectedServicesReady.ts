import type { BackendTargetRefV1, ConnectedServiceBindingsV1, ConnectedServiceId } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { resolveSessionAgentSpawnConnectedServicesDefaults } from '@/session/services/spawn/normalizeSessionAgentSpawnActionRequest';
import { logger } from '@/ui/logger';

type ProfilesApi = Readonly<{
  listConnectedServiceProfiles?: (input: Readonly<{ serviceId: ConnectedServiceId }>) => Promise<Readonly<{
    profiles?: ReadonlyArray<Readonly<{ profileId: string; status?: string }>>;
  }>>;
}>;

export type ConnectedServicesProfilesApiFactory = (credentials: Credentials) => Promise<ProfilesApi>;

export type TargetConnectedServicesReadiness =
  | Readonly<{ ready: true }>
  | Readonly<{
    ready: false;
    serviceId: string;
    profileId: string;
    reason: 'profile_missing' | 'needs_reauth';
  }>;

async function createDefaultApi(credentials: Credentials): Promise<ProfilesApi> {
  const { ApiClient } = await import('@/api/api');
  return await ApiClient.create(credentials) as unknown as ProfilesApi;
}

/**
 * Whether the account the target Agent would run under can start, judged BEFORE the source Agent is
 * stopped. The spawn refuses an account that was removed or needs reconnecting, but by then the
 * source is already stopped and the Session committed to the target, which strands it. Checking up
 * front lets the switch be refused with the source untouched.
 *
 * The account judged is the one the owner explicitly chose, otherwise the account default. Pool
 * bindings are left to the pool logic, and an account list that cannot be read never blocks a
 * switch: uncertainty is not evidence the account is unusable.
 */
export async function checkTargetConnectedServicesReady(params: Readonly<{
  credentials: Credentials;
  targetBackendTarget: BackendTargetRefV1;
  explicitConnectedServices?: ConnectedServiceBindingsV1;
  deps?: Readonly<{
    createApi?: ConnectedServicesProfilesApiFactory;
    resolveDefaults?: (input: Readonly<{ credentials: Credentials; backendTarget: BackendTargetRefV1 }>) => Promise<
      Readonly<{ connectedServices: ConnectedServiceBindingsV1 }> | null
    >;
  }>;
}>): Promise<TargetConnectedServicesReadiness> {
  let bindings: ConnectedServiceBindingsV1 | null = params.explicitConnectedServices ?? null;
  if (!bindings) {
    const resolveDefaults = params.deps?.resolveDefaults ?? resolveSessionAgentSpawnConnectedServicesDefaults;
    bindings = (await resolveDefaults({ credentials: params.credentials, backendTarget: params.targetBackendTarget })
      .catch(() => null))?.connectedServices ?? null;
  }
  if (!bindings) return { ready: true };

  const profileBindings = Object.entries(bindings.bindingsByServiceId).flatMap(([serviceId, binding]) => (
    binding.source === 'connected' && binding.selection === 'profile'
      ? [{ serviceId: serviceId as ConnectedServiceId, profileId: binding.profileId }]
      : []
  ));
  if (profileBindings.length === 0) return { ready: true };

  let api: ProfilesApi;
  try {
    api = await (params.deps?.createApi ?? createDefaultApi)(params.credentials);
  } catch {
    return { ready: true };
  }
  if (typeof api.listConnectedServiceProfiles !== 'function') return { ready: true };

  for (const { serviceId, profileId } of profileBindings) {
    let profiles: ReadonlyArray<Readonly<{ profileId: string; status?: string }>> | undefined;
    try {
      profiles = (await api.listConnectedServiceProfiles({ serviceId }))?.profiles;
    } catch {
      continue;
    }
    if (!Array.isArray(profiles)) continue;
    const profile = profiles.find((candidate) => candidate.profileId === profileId);
    const reason = !profile ? 'profile_missing' : profile.status === 'needs_reauth' ? 'needs_reauth' : null;
    if (reason) {
      logger.warn('[AGENT TRANSITION] Target account cannot start; refusing before the source is stopped', {
        serviceId,
        profileId,
        reason,
      });
      return { ready: false, serviceId, profileId, reason };
    }
  }
  return { ready: true };
}
