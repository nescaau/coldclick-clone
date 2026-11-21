import { AvatarLibrary } from '@/components/avatars/AvatarLibrary';
import { listAvatars } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

export default function AvatarsPage() {
  return <AvatarLibrary avatars={listAvatars()} />;
}
