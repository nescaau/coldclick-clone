'use client';

import {
  BookOpen,
  Bell,
  ChevronDown,
  Clapperboard,
  Copy,
  KeyRound,
  LayoutDashboard,
  Library,
  Link2,
  LifeBuoy,
  Moon,
  Package,
  PanelLeft,
  Receipt,
  Settings,
  Sun,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { CURRENT_USER, NAV, pageTitleFor, ROUTES, type NavIconName, type NavItem, type NavLeaf } from '@/lib/nav';
import { cn, ToastProvider, useToast } from '../ui';

const ICONS: Record<NavIconName, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  package: Package,
  link: Link2,
  clapperboard: Clapperboard,
  video: Video,
  library: Library,
  users: Users,
  key: KeyRound,
  settings: Settings,
  bell: Bell,
  receipt: Receipt,
  'book-open': BookOpen,
  'life-buoy': LifeBuoy,
};

/** Rota ativa: igual ou filha (ex.: /trabalhos/123 ativa "Trabalhos"). */
const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

function Logo() {
  return (
    <Link href={ROUTES.jobs} aria-label="ColdClick Affiliates" className="flex items-center rounded-md">
      {/* Floco de 6 braços com pontas em "V" (aproximação do ícone da marca) */}
      <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-foreground" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7" />
        <path d="m9.6 3.8 2.4 1.9 2.4-1.9M9.6 20.2l2.4-1.9 2.4 1.9M4.6 8.4l3 .4.6 3M19.4 15.6l-3-.4-.6-3M19.4 8.4l-3 .4-.6 3M4.6 15.6l3-.4.6-3" />
      </svg>
      <span className="ml-px text-[22px] font-normal leading-none tracking-[-0.02em]">
        Cold<span className="text-primary">Click</span>
      </span>
      <span className="ml-2.5 mt-0.5 text-sm font-bold">Affiliates</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

const ITEM_BASE = 'flex w-full min-w-0 items-center overflow-hidden rounded-md text-left text-sm transition-colors';

function NavLeafLink({ leaf, pathname }: { leaf: NavLeaf; pathname: string }) {
  const Icon = leaf.icon ? ICONS[leaf.icon] : null;
  const active = isActive(pathname, leaf.href);
  return (
    <Link
      href={leaf.href}
      className={cn(
        ITEM_BASE,
        'h-9 gap-2 px-3',
        active ? 'bg-primary/[0.14] font-semibold text-foreground' : 'font-normal text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className="truncate">{leaf.label}</span>
    </Link>
  );
}

function NavGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = item.icon ? ICONS[item.icon] : null;
  const children = item.children ?? [];
  // O grupo fica em destaque quando alguma rota filha está ativa.
  const active = children.length ? children.some((c) => isActive(pathname, c.href)) : isActive(pathname, item.href);

  return (
    <li>
      <div className="relative">
        <Link
          href={item.href}
          className={cn(
            ITEM_BASE,
            'h-10 gap-3 px-3 font-medium',
            children.length > 0 && 'pr-8',
            active ? 'bg-primary/[0.14] font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          {Icon && <Icon className="size-4 shrink-0" />}
          <span className="truncate">{item.label}</span>
        </Link>
        {children.length > 0 && (
          <button
            type="button"
            aria-label={`${expanded ? 'Recolher' : 'Expandir'} submenu de ${item.label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-4 transition-transform', !expanded && '-rotate-90')} />
          </button>
        )}
      </div>
      {children.length > 0 && expanded && (
        <ul className="mt-1 space-y-1 pb-1 pl-6 pr-3.5">
          {children.map((c) => (
            <li key={c.href}>
              <NavLeafLink leaf={c} pathname={pathname} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function BtagFooter() {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CURRENT_USER.btag);
      toast('btag copiada.');
    } catch {
      toast('Não foi possível copiar a btag.');
    }
  };
  return (
    <div className="flex h-[61px] shrink-0 items-center justify-between border-t border-border px-4">
      <p className="text-sm text-muted-foreground">
        btag <span className="font-mono font-bold text-link">{CURRENT_USER.btag}</span>
      </p>
      <button
        type="button"
        aria-label="Copiar btag"
        onClick={copy}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar transition-transform duration-200',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-[92px] shrink-0 items-start px-4 pt-[30px]">
        <Logo />
      </div>
      <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-2 pb-2" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate()}>
        <ul className="space-y-1">
          {NAV.map((item) => (
            <NavGroup key={item.label} item={item} pathname={pathname} />
          ))}
        </ul>
      </nav>
      <BtagFooter />
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Topbar                                                              */
/* ------------------------------------------------------------------ */

const ICON_BUTTON =
  'relative inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground';

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cc-theme', next);
    } catch {
      /* armazenamento indisponível: o tema vale só nesta sessão */
    }
  };
  return (
    <button type="button" aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'} onClick={toggle} className={ICON_BUTTON}>
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** Pequeno popover ancorado à direita da topbar. */
function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-border bg-card p-2 shadow-xl">{children}</div>
    </>
  );
}

function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const pathname = usePathname();
  const title = pageTitleFor(pathname);
  const [menu, setMenu] = useState<'bell' | 'user' | null>(null);
  const close = () => setMenu(null);

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-border bg-background/95 pl-6 pr-7 backdrop-blur">
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={onToggleSidebar} className={ICON_BUTTON}>
          <PanelLeft className="size-4" />
          <span className="sr-only">Abrir ou fechar o menu</span>
        </button>
        <div className="mx-3 h-6 w-px bg-border" aria-hidden />
        <h2 className="truncate text-base font-semibold">{title}</h2>
        <nav aria-label="breadcrumb" className="sr-only">
          <ol>
            <li>
              <Link href={ROUTES.jobs}>Estúdio criativo</Link>
            </li>
            <li>{title}</li>
          </ol>
        </nav>
      </div>

      <div className="flex items-center gap-1">
        <div className="relative">
          <button type="button" aria-label="Notificações" onClick={() => setMenu(menu === 'bell' ? null : 'bell')} className={ICON_BUTTON}>
            <Bell className="size-4" />
          </button>
          <Popover open={menu === 'bell'} onClose={close}>
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
          </Popover>
        </div>
        <ThemeToggle />
        <div className="relative">
          <button
            type="button"
            aria-label={`Menu de ${CURRENT_USER.name}`}
            onClick={() => setMenu(menu === 'user' ? null : 'user')}
            className="flex min-h-11 items-center gap-2 rounded-xl px-1.5 text-left transition-colors hover:bg-secondary"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/[0.14] text-xs font-semibold text-link">
              {CURRENT_USER.initials}
            </span>
            <span className="max-w-[6.5rem] truncate text-sm font-medium">{CURRENT_USER.name}</span>
          </button>
          <Popover open={menu === 'user'} onClose={close}>
            <Link
              href={ROUTES.studioSettings}
              onClick={close}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary"
            >
              <Settings className="size-4" /> Configurações do estúdio
            </Link>
          </Popover>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/** Estrutura do estúdio: sidebar fixa de 256px, topbar de 72px e conteúdo limitado a 1400px. */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  // Em telas estreitas o menu começa fechado (vira gaveta sobre o conteúdo).
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setOpen(false);
  }, []);
  const closeOnMobile = () => window.matchMedia('(max-width: 767px)').matches && setOpen(false);

  return (
    <ToastProvider>
      <Sidebar open={open} onNavigate={closeOnMobile} />
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className={cn('min-h-screen transition-[padding] duration-200', open && 'md:pl-64')}>
        <Topbar onToggleSidebar={() => setOpen((v) => !v)} />
        <main className="max-w-[1400px] px-4 pb-10 md:px-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
