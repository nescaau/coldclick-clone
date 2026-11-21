/**
 * Rotas e itens de navegação — fonte única para a sidebar, a topbar (título/breadcrumb) e redirecionamentos.
 * Rótulos idênticos aos da plataforma de referência; as rotas do estúdio seguem o padrão em PT-BR.
 */
export const ROUTES = {
  newJob: '/novo-trabalho',
  jobs: '/trabalhos',
  avatars: '/avatares',
  flowAccounts: '/contas-flow',
  geminiKeys: '/chaves-gemini',
  /** Configurações do estúdio (Whisper e armazenamento) — acessível pelo menu do usuário. */
  studioSettings: '/configuracoes',
} as const;

/** Seções da plataforma que NÃO fazem parte da réplica do estúdio: levam a uma página explicativa. */
export const platformHref = (slug: string) => `/plataforma/${slug}`;

export type NavIconName =
  | 'layout-dashboard'
  | 'package'
  | 'link'
  | 'clapperboard'
  | 'video'
  | 'library'
  | 'users'
  | 'key'
  | 'settings'
  | 'bell'
  | 'receipt'
  | 'book-open'
  | 'life-buoy';

export interface NavLeaf {
  label: string;
  href: string;
  icon?: NavIconName;
}
export interface NavItem extends NavLeaf {
  /** Submenu expansível (com o botão "Recolher submenu de …"). */
  children?: NavLeaf[];
}

export const NAV: NavItem[] = [
  { label: 'Painel', href: platformHref('overview'), icon: 'layout-dashboard' },
  { label: 'Ofertas', href: platformHref('offers'), icon: 'package' },
  {
    label: 'Meus links',
    href: platformHref('links'),
    icon: 'link',
    children: [{ label: 'Gerar link', href: platformHref('links-new') }],
  },
  {
    label: 'Estúdio criativo',
    href: ROUTES.jobs,
    icon: 'clapperboard',
    children: [
      { label: 'Trabalhos', href: ROUTES.jobs, icon: 'video' },
      { label: 'Novo trabalho', href: ROUTES.newJob, icon: 'clapperboard' },
      { label: 'Avatares', href: ROUTES.avatars, icon: 'library' },
      { label: 'Contas Flow', href: ROUTES.flowAccounts, icon: 'users' },
      { label: 'Chaves Gemini', href: ROUTES.geminiKeys, icon: 'key' },
    ],
  },
  {
    label: 'Configurações',
    href: platformHref('settings'),
    icon: 'settings',
    children: [
      { label: 'Perfis', href: platformHref('settings-profiles') },
      { label: 'Notificações', href: platformHref('settings-notifications'), icon: 'bell' },
    ],
  },
  { label: 'Vendas', href: platformHref('sales'), icon: 'receipt' },
  { label: 'Tutoriais', href: platformHref('tutorials'), icon: 'book-open' },
  { label: 'Suporte', href: platformHref('support'), icon: 'life-buoy' },
];

/** Título da topbar por rota (+ breadcrumb "Estúdio criativo / <título>"). */
const PAGE_TITLES: Record<string, string> = {
  [ROUTES.jobs]: 'Trabalhos',
  [ROUTES.newJob]: 'Novo trabalho',
  [ROUTES.avatars]: 'Avatares',
  [ROUTES.flowAccounts]: 'Contas Flow',
  [ROUTES.geminiKeys]: 'Chaves Gemini',
  [ROUTES.studioSettings]: 'Configurações do estúdio',
};

export function pageTitleFor(pathname: string): string {
  const exact = PAGE_TITLES[pathname];
  if (exact) return exact;
  const base = Object.keys(PAGE_TITLES).find((r) => pathname.startsWith(`${r}/`));
  return base ? PAGE_TITLES[base] : 'ColdClick Affiliates';
}

/** Usuário exibido na topbar/sidebar. Edite aqui: não há autenticação nesta réplica local. */
export const CURRENT_USER = { name: 'Henrique Ferreira', initials: 'HF', btag: 'cckstofy' } as const;
