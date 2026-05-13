// ── Sidebar — Navigation latérale (Sprint Design) ───────────

import { Link, useLocation } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useState, useEffect, type ReactNode } from 'react';
import {
  LayoutDashboard, Users, Briefcase, MessageSquare, Mail,
  Zap, FileText, Star, CalendarDays, CheckSquare, Plug,
  BarChart3, Settings, LogOut, ChevronLeft, ChevronRight,
  UserCircle, CreditCard, Trash2, Link2, ClipboardList, Bookmark,
} from 'lucide-react';
import { getSmartLists } from '@/lib/api';
import type { SmartList } from '@/lib/types';

interface NavSection {
  label?: string;
  items: { path: string; label: string; icon: ReactNode; adminOnly?: boolean }[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ],
  },
  {
    label: 'WORKSPACE',
    items: [
      { path: '/leads', label: 'Leads', icon: <Users size={18} /> },
      { path: '/properties', label: 'Propriétés', icon: <Briefcase size={18} /> },
      { path: '/agencies', label: 'Agences', icon: <Briefcase size={18} />, adminOnly: true },
      { path: '/clients', label: 'Clients', icon: <UserCircle size={18} />, adminOnly: true },
      { path: '/pipeline', label: 'Pipeline', icon: <Briefcase size={18} /> },
      { path: '/invoices', label: 'Factures', icon: <CreditCard size={18} /> },
      { path: '/conversations', label: 'Conversations', icon: <MessageSquare size={18} /> },
    ],
  },
  {
    label: 'MARKETING',
    items: [
      { path: '/templates', label: 'Templates', icon: <Mail size={18} /> },
      { path: '/workflows', label: 'Automations', icon: <Zap size={18} /> },
      { path: '/trigger-links', label: 'Trigger Links', icon: <Link2 size={18} /> },
      { path: '/forms/builder/new', label: 'Formulaires', icon: <ClipboardList size={18} /> },
    ],
  },
  {
    label: 'INSIGHTS',
    items: [
      { path: '/documents', label: 'Documents', icon: <FileText size={18} /> },
      { path: '/documents/templates', label: 'Modèles docs', icon: <FileText size={18} /> },
      { path: '/reviews', label: 'Avis', icon: <Star size={18} /> },
      { path: '/calendar', label: 'Calendrier', icon: <CalendarDays size={18} /> },
      { path: '/tasks', label: 'Tâches', icon: <CheckSquare size={18} /> },
      { path: '/integrations', label: 'Intégrations', icon: <Plug size={18} /> },
      { path: '/reports', label: 'Rapports', icon: <BarChart3 size={18} /> },
    ],
  },
  {
    items: [
      { path: '/settings', label: 'Paramètres', icon: <Settings size={18} /> },
      { path: '/trash', label: 'Corbeille', icon: <Trash2 size={18} /> },
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

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    getSmartLists().then(r => { if (r.data) setSmartLists(r.data); }).catch(() => {});
  }, []);

  const sidebarWidth = collapsed ? 'w-16' : 'w-60';

  return (
    <>
      {/* Overlay mobile */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 z-50 h-full ${sidebarWidth}
        bg-[var(--bg-inverse)] text-[var(--text-inverse)]
        flex flex-col transition-all duration-200 relative overflow-hidden
        lg:translate-x-0 lg:static lg:z-auto
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Blob décoratif (maquette) */}
        <div className="absolute rounded-full pointer-events-none" style={{ background: '#009DDB', width: 240, height: 240, top: -60, right: -120, opacity: 0.4, filter: 'blur(40px)' }} />
        {/* Logo + collapse toggle */}
        <div className="h-14 flex items-center justify-between px-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-base relative"
              style={{
                background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                boxShadow: '0 4px 16px rgba(0,157,219,0.55), 0 0 24px rgba(217,110,39,0.3)',
                color: 'white',
              }}>
              I
              {/* Subtle pulse halo */}
              <div className="absolute inset-0 rounded-xl pointer-events-none"
                style={{ boxShadow: '0 0 0 2px rgba(0,157,219,0.2)', animation: 'hot-lead-pulse 3.5s ease-in-out infinite' }} />
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="text-sm font-bold leading-tight text-white whitespace-nowrap tracking-tight">Intralys</h1>
                <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'rgba(111,206,240,0.7)' }}>CRM</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1 rounded-[var(--radius-xs)] text-[var(--text-inverse-mut)] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-0.5 relative z-10">
          {NAV_SECTIONS.map((section, si) => {
            const items = section.items.filter(it => !it.adminOnly || isAdmin);
            if (items.length === 0) return null;
            return (
              <div key={si}>
                {section.label && !collapsed && (
                  <p className="px-3 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-inverse-mut)]">
                    {section.label}
                  </p>
                )}
                {section.label && collapsed && <div className="my-2 mx-2 border-t border-white/10" />}
                {items.map(item => {
                  const isActive = location.pathname === item.path ||
                    (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={`
                        flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                        transition-all duration-200 relative
                        ${isActive ? '' : 'hover:bg-white/[0.05]'}
                        ${collapsed ? 'justify-center' : ''}
                      `}
                      style={isActive ? {
                        // Sprint 23 — gradient brand + glow visible
                        background: 'linear-gradient(90deg, rgba(0,157,219,0.22) 0%, rgba(0,157,219,0.08) 100%)',
                        color: '#6FCEF0',
                        boxShadow: 'inset 0 0 0 1px rgba(0,157,219,0.25), 0 0 20px -4px rgba(0,157,219,0.4)',
                      } : { color: 'rgba(255,255,255,0.85)' }}
                    >
                      {/* Barre latérale active glowing */}
                      {isActive && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                          style={{
                            background: 'linear-gradient(180deg, #009DDB 0%, #D96E27 100%)',
                            boxShadow: '0 0 8px rgba(0,157,219,0.8), 2px 0 4px rgba(0,157,219,0.4)',
                          }} />
                      )}
                      <span className="shrink-0">{item.icon}</span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
                {/* Sprint 21 — Smart Lists pinées sous la section Workspace */}
                {section.label === 'WORKSPACE' && smartLists.length > 0 && (
                  <>
                    {!collapsed && (
                      <p className="px-3 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-inverse-mut)]/70">
                        Vues sauvegardées
                      </p>
                    )}
                    {smartLists.slice(0, 5).map(sl => {
                      const searchStr = typeof location.search === 'string' ? location.search : JSON.stringify(location.search || {});
                      const isActive = location.pathname === '/leads' && searchStr.includes(sl.id);
                      // Sprint 21 fix : utiliser <a> simple plutôt que TanStack <Link> avec query string
                      // (Link strict-typed n'accepte pas "/leads?smart=xxx", il faudrait `search={{smart}}`
                      // mais Leads.tsx ne parse pas encore ce param — pour Sprint 22 ce lien est juste pour
                      // pré-naviguer, le filtre actuel attend une intégration backend séparée)
                      return (
                        <a
                          key={sl.id}
                          href={`/leads?smart=${sl.id}`}
                          onClick={(e) => {
                            // Cmd/Ctrl-click → laisser le browser ouvrir un nouvel onglet
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            e.preventDefault();
                            onClose();
                            // Pas de navigation TanStack ici (pas de typage strict des search params) ;
                            // on utilise window.history pour préserver le SPA
                            window.history.pushState({}, '', `/leads?smart=${sl.id}`);
                            window.dispatchEvent(new PopStateEvent('popstate'));
                          }}
                          title={sl.name}
                          className={`
                            flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs font-medium
                            transition-all duration-[80ms] relative
                            ${isActive ? 'text-[#6FCEF0]' : 'hover:bg-white/[0.05]'}
                            ${collapsed ? 'justify-center' : ''}
                          `}
                          style={isActive ? { background: 'rgba(0,157,219,0.15)' } : { color: 'rgba(255,255,255,0.7)' }}
                        >
                          <Bookmark size={14} className="shrink-0" />
                          {!collapsed && <span className="truncate">{sl.name}</span>}
                        </a>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer profil — Sprint 23 : carte premium avec gradient + glow */}
        <div className="px-3 py-3 border-t border-white/5 shrink-0 relative z-10">
          <div className={`flex items-center rounded-xl transition-all ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-2 py-2'}`}
            style={{
              background: 'linear-gradient(135deg, rgba(0,157,219,0.12) 0%, rgba(217,110,39,0.08) 100%)',
              border: '1px solid rgba(0,157,219,0.18)',
              boxShadow: '0 0 16px -4px rgba(0,157,219,0.2)',
            }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 relative"
              style={{
                background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                color: 'white',
                boxShadow: '0 4px 12px rgba(217,110,39,0.5), 0 0 8px rgba(0,157,219,0.4)',
              }}>
              {user?.name?.charAt(0)?.toUpperCase() || 'R'}{user?.name?.split(' ')[1]?.charAt(0)?.toUpperCase() || 'B'}
              {/* Status dot online */}
              <span aria-hidden className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                style={{
                  background: 'var(--success)',
                  borderColor: 'oklch(0.18 0.022 260)',
                  boxShadow: '0 0 6px rgba(55,202,55,0.7)',
                }} />
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{user?.name || 'Admin'}</p>
                <p className="text-[10px] truncate" style={{ color: 'rgba(111,206,240,0.7)' }}>
                  {isAdmin ? '★ Administrateur' : 'Utilisateur'}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={logout}
                className="p-1.5 rounded-lg text-[var(--text-inverse-mut)] hover:text-[var(--danger)] hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="Déconnexion"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
