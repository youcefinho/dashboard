// ── MobileBottomNav — Navigation rapide mobile (Sprint 9) ───
// Barre de navigation fixée en bas sur mobile, avec 5 raccourcis principaux

import { Link, useLocation } from '@tanstack/react-router';
import { LayoutDashboard, Users, Briefcase, MessageSquare, MoreHorizontal } from 'lucide-react';
import { Icon } from '@/components/ui';
import { t } from '@/lib/i18n';

const NAV_ITEMS = [
  { path: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
  { path: '/leads', label: t('nav.leads'), icon: Users },
  { path: '/pipeline', label: t('nav.pipeline'), icon: Briefcase },
  { path: '/conversations', label: t('nav.inbox'), icon: MessageSquare },
  { path: '/settings', label: t('nav.more'), icon: MoreHorizontal },
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
        const ItemIcon = item.icon;
        const isActive = location.pathname.startsWith(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`relative ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            style={isActive ? {
              color: 'var(--primary)',
            } : undefined}
          >
            {isActive && (
              <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full"
                style={{
                  background: 'var(--primary)',
                  boxShadow: '0 2px 8px rgba(0,157,219,0.6), 0 0 12px rgba(217,110,39,0.4)',
                }} />
            )}
            <Icon as={ItemIcon} size={20} style={isActive ? { filter: 'drop-shadow(0 0 8px rgba(0,157,219,0.4))' } : undefined} />
            <span style={isActive ? { fontWeight: 700 } : undefined}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
