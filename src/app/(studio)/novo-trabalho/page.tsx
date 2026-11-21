import { NewJobWizard } from '@/components/wizard/NewJobWizard';
import { REQUIRE_FLOW_CONNECTION } from '@/lib/config';
import { listAvatars } from '@/lib/services/avatar-service';
import { getExtensionOverview } from '@/lib/services/extension-service';
import { listProductNames } from '@/lib/services/product-service';
import { getPublicSettings } from '@/lib/services/settings-service';
import { listVideos } from '@/lib/services/video-service';
import { getStorageUsage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default function NewJobPage() {
  return (
    <NewJobWizard
      initialVideos={listVideos()}
      initialAvatars={listAvatars()}
      products={listProductNames()}
      transcriptionReady={getPublicSettings().whisperConfigured}
      storage={getStorageUsage()}
      flowConnected={getExtensionOverview().onlineCount > 0}
      requireFlowConnection={REQUIRE_FLOW_CONNECTION}
    />
  );
}
