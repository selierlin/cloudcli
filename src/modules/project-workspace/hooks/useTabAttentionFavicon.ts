import { useEffect } from 'react';

import { usePendingApprovalSessionIds } from '@/shared/context/SessionProtectionContext';
import { setApprovalIndicator } from '@/shared/favicon';

/**
 * Used by the project workspace route to mirror the sessions the running-sessions poll
 * reports as blocked on an approval onto the tab icon. The poll is provider-agnostic:
 * only providers that implement `permissions.listPending` (claude, dsh, openclaw) put
 * entries in that set, so this raises nothing for the others rather than lying.
 */
export function useTabAttentionFavicon(): void {
  const pendingApprovalSessionIds = usePendingApprovalSessionIds();
  const hasPendingApproval = pendingApprovalSessionIds.size > 0;

  useEffect(() => {
    setApprovalIndicator(hasPendingApproval);
  }, [hasPendingApproval]);
}
