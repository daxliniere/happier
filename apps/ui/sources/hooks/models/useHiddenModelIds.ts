import * as React from 'react';

import { getHiddenModelIds } from '@/sync/domains/models/modelVisibility';
import { useSetting } from '@/sync/domains/state/storage';

export function useHiddenModelIds(backendTargetKey: string | null | undefined): ReadonlySet<string> {
    const selections = useSetting('hiddenModelSelectionsV1');
    return React.useMemo(() => getHiddenModelIds(selections, backendTargetKey), [backendTargetKey, selections]);
}
