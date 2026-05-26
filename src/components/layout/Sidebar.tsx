// ── Sidebar — Navigation latérale (Sprint Design) ───────────

import { Link, useLocation } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useState, useEffect, useCallback, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties } from 'react';
import {
  LayoutDashboard, Users, Briefcase, MessageSquare, Mail,
  Zap, FileText, Star, CalendarDays, CheckSquare, Plug,
  BarChart3, Settings, LogOut, ChevronLeft, ChevronRight,
  UserCircle, CreditCard, Trash2, Link2, ClipboardList, Bookmark,
  ShieldCheck, Store, Package, ShoppingCart, Contact,
  LayoutTemplate, Phone,
  // Sprint 21 — Onboarding durci : icône "Premiers pas"
  Sparkles,
} from 'lucide-react';
import { Icon } from '@/components/ui';
import { getSmartLists, getLeads, getTasks, getNotifications, getModules, getClientBranding, getActiveSubAccount, getOnboardingChecklist, type ModuleId } from '@/lib/api';
import type { SmartList, TenantBranding, ClientBrandingMeta } from '@/lib/types';
// Sprint 45 M1.4 — Onboarding progress chip (auto-hide quand 5/5 atteint)
import { OnboardingProgressChip } from '@/components/onboarding/OnboardingProgressChip';
import { t } from '@/lib/i18n';

interface NavSection {
  label?: string;
  items: { path: string; label: string; icon: ReactNode; adminOnly?: boolean; moduleRequired?: ModuleId; badgeKey?: 'leadsNew' | 'tasksTodo' | 'notifsUnread' }[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { path: '/dashboard', label: t('nav.dashboard'), icon: <Icon as={LayoutDashboard} size={18} /> },
    ],
  },
  {
    label: t('nav.workspace'),
    items: [
      { path: '/leads', label: t('nav.leads'), icon: <Icon as={Users} size={18} />, badgeKey: 'leadsNew' },
      { path: '/properties', label: t('nav.properties'), icon: <Icon as={Briefcase} size={18} /> },
      { path: '/agencies', label: t('nav.agencies'), icon: <Icon as={Briefcase} size={18} />, adminOnly: true },
      { path: '/clients', label: t('nav.clients'), icon: <Icon as={UserCircle} size={18} />, adminOnly: true },
      { path: '/pipeline', label: t('nav.pipeline'), icon: <Icon as={Briefcase} size={18} /> },
      { path: '/invoices', label: t('nav.invoices'), icon: <Icon as={CreditCard} size={18} /> },
      // ── Sprint 18 CATALOGUE DE SERVICES — catalogue d'articles service/produit ──
      { path: '/catalog', label: t('catalog.title'), icon: <Icon as={Package} size={18} /> },
      { path: '/conversations', label: t('nav.conversations'), icon: <Icon as={MessageSquare} size={18} />, badgeKey: 'notifsUnread' },
    ],
  },
  {
    label: t('nav.marketing'),
    items: [
      { path: '/templates', label: t('nav.templates'), icon: <Icon as={Mail} size={18} /> },
      { path: '/workflows', label: t('nav.automations'), icon: <Icon as={Zap} size={18} /> },
      { path: '/trigger-links', label: t('nav.trigger_links'), icon: <Icon as={Link2} size={18} /> },
      { path: '/forms/builder/new', label: t('nav.forms'), icon: <Icon as={ClipboardList} size={18} /> },
      // ── LOT FUNNEL — builder landing pages / funnels ──
      { path: '/funnels', label: t('funnel.nav'), icon: <Icon as={LayoutTemplate} size={18} /> },
      // ── LOT MARKETPLACE (Sprint 19) — catalogue de modèles cross-tenant (G7, non gated) ──
      { path: '/marketplace', label: t('marketplace.nav'), icon: <Icon as={Store} size={18} /> },
    ],
  },
  {
    label: t('nav.insights'),
    items: [
      { path: '/documents', label: t('nav.documents'), icon: <Icon as={FileText} size={18} /> },
      { path: '/documents/templates', label: t('nav.doc_templates'), icon: <Icon as={FileText} size={18} /> },
      { path: '/reviews', label: t('nav.reviews'), icon: <Icon as={Star} size={18} /> },
      // ── LOT TELEPHONY-DISPOSITION (Sprint 16) — journal d'appels global ──
      { path: '/telephonie', label: t('telephony.page.title'), icon: <Icon as={Phone} size={18} /> },
      { path: '/calendar', label: t('nav.calendar'), icon: <Icon as={CalendarDays} size={18} /> },
      { path: '/tasks', label: t('nav.tasks'), icon: <Icon as={CheckSquare} size={18} />, badgeKey: 'tasksTodo' },
      { path: '/integrations', label: t('nav.integrations'), icon: <Icon as={Plug} size={18} /> },
      { path: '/reports', label: t('nav.reports'), icon: <Icon as={BarChart3} size={18} /> },
    ],
  },
  {
    label: t('nav.administration'),
    items: [
      { path: '/admin/overview', label: t('nav.admin_overview'), icon: <Icon as={ShieldCheck} size={18} />, adminOnly: true },
    ],
  },
  {
    label: t('nav.boutique'),
    items: [
      { path: '/boutique', label: t('nav.shop_dashboard'), icon: <Icon as={Store} size={18} />, moduleRequired: 'ecommerce' },
      { path: '/boutique/produits', label: t('nav.shop_products'), icon: <Icon as={Package} size={18} />, moduleRequired: 'ecommerce' },
      { path: '/boutique/commandes', label: t('nav.shop_orders'), icon: <Icon as={ShoppingCart} size={18} />, moduleRequired: 'ecommerce' },
      { path: '/boutique/clients', label: t('nav.shop_customers'), icon: <Icon as={Contact} size={18} />, moduleRequired: 'ecommerce' },
    ],
  },
  {
    items: [
      { path: '/settings', label: t('nav.settings'), icon: <Icon as={Settings} size={18} /> },
      { path: '/trash', label: t('nav.trash'), icon: <Icon as={Trash2} size={18} /> },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1');
  // Sprint 21 : smart lists pinned (saved views first-class)
  const [smartLists, setSmartLists] = useState<SmartList[]>([]);
  // Sprint 23 wave 16 — count badges (signature GHL)
  const [badgeCounts, setBadgeCounts] = useState<{ leadsNew: number; tasksTodo: number; notifsUnread: number }>({ leadsNew: 0, tasksTodo: 0, notifsUnread: 0 });
  // Sprint E1 M2.2 — modules actifs du tenant (gate la section BOUTIQUE).
  // Défaut ['crm'] : tant que non chargé, section e-commerce masquée (no flash).
  const [activeModules, setActiveModules] = useState<ModuleId[]>(['crm']);
  // ── Sprint 21 (Onboarding durci) — entrée nav "Premiers pas" visible
  //    UNIQUEMENT si la checklist n'est pas complète (pct < 100). Best-effort :
  //    si l'API fail, on garde l'entrée masquée par défaut (null) pour éviter
  //    le flash. Refresh sur route change (calque badgeCounts).
  const [checklistPct, setChecklistPct] = useState<number | null>(null);
  // ── LOT WHITE-LABEL APPLY (Sprint 20) — branding tenant (logo/nom conditionnels).
  //    Null/sans champ ⇒ fallback Intralys (rétro-compat byte). Hydraté par
  //    l'évènement `intralys:branding` (émis par AppLayout au boot / changement
  //    de sous-compte) + un fetch léger au mount (premier rendu correct).
  const [branding, setBranding] = useState<TenantBranding | null>(null);

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    getSmartLists().then(r => { if (r.data) setSmartLists(r.data); }).catch(() => {});
  }, []);

  // Sprint E1 M2.2 — charge les modules actifs (gate section BOUTIQUE)
  useEffect(() => {
    let cancelled = false;
    getModules()
      .then(r => { if (!cancelled && r.data?.active) setActiveModules(r.data.active); })
      .catch(() => { /* fallback ['crm'] : section e-commerce masquée */ });
    return () => { cancelled = true; };
  }, []);

  // ── LOT WHITE-LABEL APPLY (Sprint 20) — branding tenant pour logo/nom Sidebar.
  //    1) Écoute l'évènement `intralys:branding` (source de vérité = AppLayout) ;
  //    2) fetch léger au mount (best-effort) pour le premier rendu si l'event a
  //       déjà été émis avant le montage de la Sidebar. Borné tenant
  //       (getActiveSubAccount). Sans branding ⇒ null ⇒ fallback Intralys.
  useEffect(() => {
    const onBranding = (e: Event) => {
      const detail = (e as CustomEvent<TenantBranding | null>).detail;
      setBranding(detail ?? null);
    };
    window.addEventListener('intralys:branding', onBranding as EventListener);

    let cancelled = false;
    void (async () => {
      try {
        const clientId = getActiveSubAccount();
        if (!clientId) return; // legacy/mono-tenant ⇒ fallback Intralys
        const res = await getClientBranding(clientId);
        if (cancelled || !res.data) return;
        const d = res.data;
        let meta: ClientBrandingMeta = {};
        if (d.branding) {
          try { meta = JSON.parse(d.branding) as ClientBrandingMeta; } catch { /* legacy non-JSON */ }
        }
        setBranding({
          logo_url: d.logo_url,
          company_name: meta.company_name || meta.companyName,
        });
      } catch { /* best-effort : fallback Intralys */ }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('intralys:branding', onBranding as EventListener);
    };
  }, []);

  // ── Sprint 21 (Onboarding durci) — fetch checklist serveur pour décider
  //    si l'entrée "Premiers pas" doit être affichée. Best-effort silencieux.
  useEffect(() => {
    let cancelled = false;
    getOnboardingChecklist()
      .then((r) => { if (!cancelled && r.data) setChecklistPct(r.data.pct); })
      .catch(() => { /* silent — entrée masquée si fail */ });
    return () => { cancelled = true; };
  }, [location.pathname]);

  // Sprint 23 wave 16 — fetch counts pour badges sidebar. Refresh sur route change.
  useEffect(() => {
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const [leadsRes, tasksRes, notifsRes] = await Promise.all([
          getLeads({ status: 'new' }).catch(() => ({ data: null })),
          getTasks({ status: 'todo' }).catch(() => ({ data: null })),
          getNotifications({ unread: true }).catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        setBadgeCounts({
          leadsNew: leadsRes.data?.length || 0,
          tasksTodo: tasksRes.data?.length || 0,
          notifsUnread: notifsRes.data?.length || 0,
        });
      } catch { /* silent */ }
    };
    void fetchCounts();
    return () => { cancelled = true; };
  }, [location.pathname]);

  const sidebarWidth = collapsed ? 'w-16' : 'w-60';

  // Sprint 23 wave 47A2 — keyboard nav flèches haut/bas sur items sidebar (a11y).
  // Délègue au nav parent : récupère tous les items focusables, navigue circulaire.
  const handleNavKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const nav = e.currentTarget;
    const items = Array.from(nav.querySelectorAll<HTMLElement>('.sidebar-nav-item'));
    if (items.length === 0) return;
    const activeEl = document.activeElement as HTMLElement | null;
    const currentIndex = activeEl ? items.indexOf(activeEl) : -1;
    let nextIndex = currentIndex;
    if (e.key === 'ArrowDown') nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    else if (e.key === 'ArrowUp') nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = items.length - 1;
    if (nextIndex !== currentIndex && items[nextIndex]) {
      e.preventDefault();
      items[nextIndex]?.focus();
    }
  }, []);

  return (
    <>
      {/* Overlay mobile */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 z-50 h-full ${sidebarWidth}
        bg-[var(--bg-surface)] text-[var(--text-primary)]
        flex flex-col transition-all duration-200 overflow-hidden
        border-r border-[var(--border)]
        lg:translate-x-0 lg:static lg:z-auto
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo + collapse toggle — Stripe-clean : white bg, signature Intralys gradient préservée uniquement sur le logo chip */}
        <div className="h-14 flex items-center justify-between px-3 border-b border-[var(--border)] shrink-0">
          {/* ── LOT WHITE-LABEL APPLY (Sprint 20) — logo/nom tenant conditionnels.
              Si le branding du sous-compte actif fournit un logo_url et/ou un
              company_name → on les affiche ; SINON fallback Intralys (chip
              gradient « I » + wordmark « Intralys » + « CRM ») — rétro-compat
              byte. Borné tenant (sous-compte actif). */}
          {(() => {
            const logoUrl = typeof branding?.logo_url === 'string' ? branding.logo_url.trim() : '';
            const companyName = typeof branding?.company_name === 'string' ? branding.company_name.trim() : '';
            const hasLogo = logoUrl.length > 0;
            const hasName = companyName.length > 0;
            return (
              <div className="flex items-center gap-2.5 overflow-hidden">
                {/* Sprint 39 39-3B — logo bump 32→36 + wordmark "Intralys" en t-h3 primary (Stripe Dashboard pattern) */}
                {hasLogo ? (
                  <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 overflow-hidden bg-[var(--bg-surface)] border border-[var(--border)]">
                    <img src={logoUrl} alt={companyName || 'Logo'} className="w-full h-full object-contain" loading="lazy" decoding="async" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 font-bold text-[15px] text-white"
                    style={{
                      background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                    }}>
                    {hasName ? companyName.charAt(0).toUpperCase() : 'I'}
                  </div>
                )}
                {!collapsed && (
                  <div className="overflow-hidden">
                    <h1 className="text-[15px] font-bold leading-tight text-[var(--primary)] whitespace-nowrap tracking-tight truncate">
                      {hasName ? companyName : 'Intralys'}
                    </h1>
                    {!hasName && (
                      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">CRM</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t('nav.expand_sidebar') : t('nav.collapse_sidebar')}
            aria-expanded={!collapsed}
            className="hidden lg:inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            {collapsed ? <Icon as={ChevronRight} size={14} /> : <Icon as={ChevronLeft} size={14} />}
          </button>
        </div>

        {/* Navigation — Stripe-clean : nav items sober, active = primary-soft bg + primary text + left border */}
        <nav
          data-tour-id="sidebar-nav"
          aria-label="Navigation principale"
          onKeyDown={handleNavKeyDown}
          className="flex-1 overflow-y-auto py-3 px-2 space-y-px sidebar-scroll"
        >
          {NAV_SECTIONS.map((section, si) => {
            const items = section.items.filter(it =>
              (!it.adminOnly || isAdmin) &&
              // Sprint E1 M2.2 — gate par module : item masqué si le module
              // requis n'est pas actif pour le tenant (e-commerce off ⇒ rien)
              (!it.moduleRequired || activeModules.includes(it.moduleRequired)),
            );
            if (items.length === 0) return null;
            return (
              <div key={si}>
                {section.label && !collapsed && (
                  <div className="px-3 pt-5 pb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {section.label}
                    </span>
                  </div>
                )}
                {section.label && collapsed && (
                  <div className="my-2 mx-3 h-px bg-[var(--border)]" />
                )}
                {items.map(item => {
                  const isActive = location.pathname === item.path ||
                    (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={`sidebar-nav-item group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors relative cursor-pointer ${collapsed ? 'justify-center' : ''} ${
                        isActive
                          ? 'is-active bg-[var(--primary-soft)] text-[var(--primary)] font-semibold'
                          : 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {/* Sprint 39 39-3B — border-left active state désormais géré via CSS .sidebar-nav-item.is-active (3px) */}
                      {/* Icon inline — pas de chip, juste l'icône en gris-500 (ou primary si actif) */}
                      <span
                        aria-hidden
                        className="inline-flex items-center justify-center shrink-0"
                        style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}
                      >
                        {item.icon}
                      </span>
                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                      {/* Sprint 39 39-3B — Count badge Stripe-PLUS : .sidebar-nav-item-badge gère variants is-active/hover via CSS */}
                      {/* Sprint 40 40-3A — Live dot variant à droite du badge (pulse subtle color-coded par badgeKey) */}
                      {!collapsed && item.badgeKey && badgeCounts[item.badgeKey] > 0 ? (
                        <span className="sidebar-nav-item-badge-wrap shrink-0">
                          <span className="sidebar-nav-item-badge">
                            {badgeCounts[item.badgeKey] > 99 ? '99+' : badgeCounts[item.badgeKey]}
                          </span>
                          <span
                            className="sidebar-nav-item-live-dot pulse-dot"
                            style={{
                              '--dot-color':
                                item.badgeKey === 'leadsNew' ? 'var(--primary)' :
                                item.badgeKey === 'tasksTodo' ? 'var(--warning)' :
                                item.badgeKey === 'notifsUnread' ? 'var(--success)' :
                                'var(--info)',
                            } as CSSProperties}
                            aria-hidden
                          />
                        </span>
                      ) : null}
                      {/* Mode collapsed : dot indicateur sober */}
                      {item.badgeKey && badgeCounts[item.badgeKey] > 0 && collapsed && (
                        <span
                          aria-hidden
                          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--primary)] border border-[var(--bg-surface)]"
                        />
                      )}
                    </Link>
                  );
                })}
                {/* Sprint 21 — Smart Lists pinées sous la section Workspace */}
                {section.label === 'WORKSPACE' && smartLists.length > 0 && (
                  <>
                    {!collapsed && (
                      <div className="px-3 pt-4 pb-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                          {t('nav.saved_views')}
                        </span>
                      </div>
                    )}
                    {smartLists.slice(0, 5).map(sl => {
                      const searchStr = typeof location.search === 'string' ? location.search : JSON.stringify(location.search || {});
                      const isActive = location.pathname === '/leads' && searchStr.includes(sl.id);
                      return (
                        <a
                          key={sl.id}
                          href={`/leads?smart=${sl.id}`}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            e.preventDefault();
                            onClose();
                            window.history.pushState({}, '', `/leads?smart=${sl.id}`);
                            window.dispatchEvent(new PopStateEvent('popstate'));
                          }}
                          title={sl.name}
                          aria-current={isActive ? 'page' : undefined}
                          className={`sidebar-nav-item group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors relative cursor-pointer ${collapsed ? 'justify-center' : ''} ${
                            isActive
                              ? 'is-active bg-[var(--primary-soft)] text-[var(--primary)] font-semibold'
                              : 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <Icon as={Bookmark} size={14} style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }} />
                          {!collapsed && <span className="truncate flex-1">{sl.name}</span>}
                        </a>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sprint 21 — Onboarding durci : entrée nav "Premiers pas" visible si
            la checklist n'est pas complète (pct < 100). Best-effort : masquée
            si l'API n'a pas répondu (checklistPct === null) pour éviter le flash. */}
        {checklistPct !== null && checklistPct < 100 && (
          <div className="px-2 pb-1">
            <Link
              to="/getting-started"
              onClick={onClose}
              title={collapsed ? t('onboarding.getting_started.title') : undefined}
              aria-current={location.pathname === '/getting-started' ? 'page' : undefined}
              className={`sidebar-nav-item group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors relative cursor-pointer ${collapsed ? 'justify-center' : ''} ${
                location.pathname === '/getting-started'
                  ? 'is-active bg-[var(--primary-soft)] text-[var(--primary)] font-semibold'
                  : 'text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span
                aria-hidden
                className="inline-flex items-center justify-center shrink-0"
                style={{ color: location.pathname === '/getting-started' ? 'var(--primary)' : 'var(--text-muted)' }}
              >
                <Icon as={Sparkles} size={18} />
              </span>
              {!collapsed && (
                <span className="truncate flex-1">{t('onboarding.getting_started.title')}</span>
              )}
              {!collapsed && (
                <span className="text-[10px] font-semibold tabular-nums text-[var(--text-muted)] shrink-0">
                  {checklistPct}%
                </span>
              )}
            </Link>
          </div>
        )}

        {/* Sprint 45 M1.4 — Onboarding progress chip (auto-hide quand 5/5) */}
        <div className={`px-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <OnboardingProgressChip collapsed={collapsed} />
        </div>

        {/* Footer profil — Stripe-clean : avatar sober + nom + caret/logout, no gradient */}
        <div className="px-2 py-2 border-t border-[var(--border)] shrink-0">
          <div className={`flex items-center rounded-md transition-colors hover:bg-[var(--bg-hover)] ${collapsed ? 'justify-center py-1.5' : 'gap-2 px-2 py-1.5'}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 relative bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)]">
              {user?.name?.charAt(0)?.toUpperCase() || 'R'}{user?.name?.split(' ')[1]?.charAt(0)?.toUpperCase() || 'B'}
              {/* Status dot online — sober */}
              <span aria-hidden className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[var(--success,#15803D)] border-2 border-[var(--bg-surface)]" />
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">{user?.name || 'Admin'}</p>
                <p className="text-[10px] text-[var(--text-muted)] truncate">
                  {isAdmin ? t('nav.role_admin') : t('nav.role_user')}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={logout}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer shrink-0"
                title={t('nav.logout')}
                aria-label={t('nav.logout')}
              >
                <Icon as={LogOut} size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
