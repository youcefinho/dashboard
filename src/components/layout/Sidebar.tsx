// ── Sidebar — Navigation latérale (Sprint Design) ───────────

import { Link, useLocation } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useState, useEffect, type ReactNode } from 'react';
import {
  LayoutDashboard, Users, Briefcase, MessageSquare, Mail,
  Zap, FileText, Star, CalendarDays, CheckSquare, Plug,
  BarChart3, Settings, LogOut, ChevronLeft, ChevronRight,
  UserCircle,
} from 'lucide-react';

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
      { path: '/clients', label: 'Clients', icon: <UserCircle size={18} />, adminOnly: true },
      { path: '/pipeline', label: 'Pipeline', icon: <Briefcase size={18} /> },
      { path: '/conversations', label: 'Conversations', icon: <MessageSquare size={18} /> },
    ],
  },
  {
    label: 'MARKETING',
    items: [
      { path: '/templates', label: 'Templates', icon: <Mail size={18} /> },
      { path: '/workflows', label: 'Automations', icon: <Zap size={18} /> },
    ],
  },
  {
    label: 'INSIGHTS',
    items: [
      { path: '/documents', label: 'Documents', icon: <FileText size={18} /> },
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

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

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
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-base shadow-lg"
              style={{ background: 'linear-gradient(135deg, #009DDB 0%, #188BF6 100%)', boxShadow: '0 4px 12px rgba(0,157,219,0.4)', color: 'white' }}>
              I
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="text-sm font-semibold leading-tight text-white whitespace-nowrap">Intralys</h1>
                <p className="text-[10px] text-[var(--text-inverse-mut)] uppercase tracking-wider">CRM</p>
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
                        transition-all duration-[80ms] relative
                        ${isActive
                          ? 'text-[#6FCEF0]'
                          : 'hover:bg-white/[0.05]'
                        }
                        ${collapsed ? 'justify-center' : ''}
                      `}
                      style={isActive ? { background: 'rgba(0,157,219,0.15)' } : { color: 'rgba(255,255,255,0.85)' }}
                    >
                      {/* Barre latérale active */}
                      {isActive && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r" style={{ background: 'var(--brand-primary)' }} />
                      )}
                      <span className="shrink-0">{item.icon}</span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer profil */}
        <div className="px-3 py-3 border-t border-white/5 shrink-0 relative z-10">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 px-2'}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{ background: 'linear-gradient(135deg, #D96E27 0%, #FF9A00 100%)', color: 'white' }}>
              {user?.name?.charAt(0)?.toUpperCase() || 'R'}{user?.name?.split(' ')[1]?.charAt(0)?.toUpperCase() || 'B'}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{user?.name || 'Admin'}</p>
                <p className="text-[10px] text-[var(--text-inverse-mut)] truncate">{isAdmin ? 'Administrateur' : 'Courtier'}</p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={logout}
                className="p-1.5 rounded-[var(--radius-xs)] text-[var(--text-inverse-mut)] hover:text-[var(--danger)] hover:bg-white/10 transition-colors cursor-pointer"
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
