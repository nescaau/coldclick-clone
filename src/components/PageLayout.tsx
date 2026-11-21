import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Esqueleto das páginas do estúdio, igual ao da referência:
 *  - com `action`: linha de ação alinhada à direita (botão de 44px) a 16px da topbar e 20px de folga até o conteúdo;
 *  - sem `action`: o conteúdo começa 28px abaixo da topbar.
 */
export function PageLayout({ action, children, className }: { action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn(action ? 'pt-4' : 'pt-7', className)}>
      {action && <div className="mb-5 flex min-h-11 items-center justify-end gap-2">{action}</div>}
      {children}
    </div>
  );
}

/** Bloco de título: eyebrow azul + h1 de 30px + descrição. */
export function PageHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: ReactNode }) {
  return (
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="text-3xl font-bold leading-10 tracking-[-0.01em]">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
