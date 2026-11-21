import { SettingsForm } from '@/components/settings/SettingsForm';
import { getPublicSettings } from '@/lib/services/settings-service';

export const dynamic = 'force-dynamic';

export default function StudioSettingsPage() {
  return <SettingsForm initial={getPublicSettings()} />;
}
