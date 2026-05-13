// ── MobileBottomNav — Navigation rapide mobile (Sprint 9) ───
// Barre de navigation fixée en bas sur mobile, avec 5 raccourcis principaux

import { Link, useLocation } from '@tanstack/react-router';
import { LayoutDashboard, Users, Briefcase, MessageSquare, MoreHorizontal } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Accueil', icon: LayoutDashboard },
  { path: '/leads', label: 'Leads', icon: Users },
  { path: '/pipeline', label: 'Pipeline', icon: Briefcase },
  { path: '/conversations', label: 'Inbox', icon: MessageSquare },
  { path: '/settings', label: 'Plus', icon: MoreHorizontal },
];

export function MobileBottomNav() {
  const location = useLocation();

  return (
    <nav className="mobile-bottom-nav" aria-label="Navigation mobile"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.95) 100%)',
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        boxShadow: '0 -8px 24px -8px rgba(0,157,219,0.1)',
      }}>
      {NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = location.pathname.startsWith(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`relative ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            style={isActive ? {
              color: 'var(--brand-primary)',
            } : undefined}
          >
            {isActive && (
              <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full"
                style={{
                  background: 'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
                  boxShadow: '0 2px 8px rgba(0,157,219,0.6), 0 0 12px rgba(217,110,39,0.4)',
                }} />
            )}
            <Icon size={20} style={isActive ? { filter: 'drop-shadow(0 0 8px rgba(0,157,219,0.4))' } : undefined} />
            <span style={isActive ? { fontWeight: 700 } : undefined}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
