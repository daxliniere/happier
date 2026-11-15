import type { ProviderAccountUsageSnapshotV1 } from '@happier-dev/protocol';
import { recordProviderAccountUsageSnapshotForSession } from '@/daemon/connectedServices/accountUsage/record';
import type { ProviderAccountUsagePersistenceScheduler } from '@/daemon/connectedServices/accountUsage/persistence';
import type { ProviderAccountUsageStore } from '@/daemon/connectedServices/accountUsage/store';
import { fetchCurrentOpenCodeUsageSnapshot } from './usageLimits';

const POLL_INTERVAL_MS = 5 * 60_000;

export type OpenCodeUsagePollSession = Readonly<{ sessionId: string; directory: string }>;

export function createOpenCodeUsageLimitsPoller(params: Readonly<{
  getSessions: () => readonly OpenCodeUsagePollSession[];
  getChildren: () => readonly unknown[];
  store: Pick<ProviderAccountUsageStore, 'recordSnapshot' | 'resolveRecordId'>;
  persistence: Pick<ProviderAccountUsagePersistenceScheduler, 'recordInBandSnapshot'> | null;
  publishRecordId: (input: Readonly<{ sessionId: string; recordId: string }>) => Promise<void>;
  now?: () => number;
  fetchSnapshot?: (input: Readonly<{ directory: string; now: number; signal: AbortSignal }>) => Promise<ProviderAccountUsageSnapshotV1 | null>;
}>): () => Promise<void> {
  const now = params.now ?? Date.now;
  const fetchSnapshot = params.fetchSnapshot ?? fetchCurrentOpenCodeUsageSnapshot;
  const lastAttemptAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();

  return async () => {
    const currentTime = now();
    await Promise.all(params.getSessions().map(async (session) => {
      const sessionId = session.sessionId.trim();
      const directory = session.directory.trim();
      if (!sessionId || !directory || currentTime - (lastAttemptAt.get(sessionId) ?? 0) < POLL_INTERVAL_MS) return;
      const active = inFlight.get(sessionId);
      if (active) return await active;
      lastAttemptAt.set(sessionId, currentTime);
      const work = (async () => {
        const snapshot = await fetchSnapshot({
          directory,
          now: currentTime,
          signal: AbortSignal.timeout(15_000),
        });
        if (!snapshot) return;
        await recordProviderAccountUsageSnapshotForSession({
          getChildren: params.getChildren,
          store: params.store,
          persistence: params.persistence,
          publishRecordId: params.publishRecordId,
          sourceProviderAccountId: snapshot.recordKey.accountSubjectId,
          sessionId,
          snapshot,
        });
      })().catch(() => {
        // The OpenCode endpoint is experimental and its availability must not interfere with daemon work.
      }).finally(() => {
        inFlight.delete(sessionId);
      });
      inFlight.set(sessionId, work);
      await work;
    }));
  };
}
