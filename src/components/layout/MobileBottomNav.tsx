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
    <nav className="mobile-bottom-nav" aria-label="Navigation mobile">
      {NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = location.pathname.startsWith(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={isActive ? 'active' : ''}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
