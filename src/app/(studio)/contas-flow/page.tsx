import { ContasFlowPage } from '@/components/flow/ContasFlowPage';
import { getAccountsOverview } from '@/lib/services/account-service';
import { getExtensionOverview } from '@/lib/services/extension-service';

export const dynamic = 'force-dynamic';

export default function FlowAccountsPage() {
  return <ContasFlowPage initialExtension={getExtensionOverview()} initialAccounts={getAccountsOverview()} />;
}
