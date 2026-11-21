import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { ensureBootstrapped } from '@/lib/services/bootstrap';

export const dynamic = 'force-dynamic';

export default function StudioLayout({ children }: { children: ReactNode }) {
  ensureBootstrapped();
  return <AppShell>{children}</AppShell>;
}
