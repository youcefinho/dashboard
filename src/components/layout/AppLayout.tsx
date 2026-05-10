// ── AppLayout — Layout principal avec Sidebar ───────────────

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate } from '@tanstack/react-router';
import { CommandPalette } from '@/components/CommandPalette';
import { useTheme } from '@/lib/useTheme';
import { getNotifications, markNotificationRead, markAllNotificationsRead, type NotificationItem } from '@/lib/api';
import { Link } from '@tanstack/react-router';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
}

// Formater le temps relatif
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  return `il y a ${days}j`;
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPwBanner, setShowPwBanner] = useState(() => localStorage.getItem('must_change_password') === '1');
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  // Charger les notifications depuis l'API
  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ limit: 20 });
      if (res.data) setNotifications(res.data);
      const raw = res as Record<string, unknown>;
      if (typeof raw.unread_count === 'number') setUnreadCount(raw.unread_count);
      else if (res.data) setUnreadCount(res.data.filter(n => !n.is_read).length);
    } catch { /* silencieux */ }
  }, []);

  // Charger au montage + poll toutes les 30s
  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => { void loadNotifications(); }, 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Raccourci ⌘K / Ctrl+K
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCmdOpen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // Fermer le dropdown en cliquant en dehors
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    await markAllNotificationsRead();
  };

  const handleNotifClick = async (notif: NotificationItem) => {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: 1 } : n));
    setUnreadCount(prev => Math.max(0, prev - (notif.is_read ? 0 : 1)));
    setNotifOpen(false);
    void markNotificationRead(notif.id);
    if (notif.link) void navigate({ to: notif.link });
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 sm:h-16 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] flex items-center justify-between px-3 sm:px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Hamburger mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h2 className="text-base sm:text-lg font-semibold truncate">{title}</h2>
          </div>

          {/* Actions header */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Recherche — ouvre la Command Palette */}
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded-[var(--radius-md)] text-xs text-[var(--color-text-muted)] w-48 lg:w-64 cursor-pointer transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Rechercher...</span>
              <span className="ml-auto text-[10px] bg-[var(--color-bg-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)]">⌘K</span>
            </button>

            {/* Recherche mobile — icône simple */}
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden p-2 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

            {/* Toggle Dark/Light */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>

            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[var(--color-danger)] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Dropdown notifications */}
              {notifOpen && (
                <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shadow-2xl z-50 overflow-hidden animate-slide-down">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
                    <h3 className="text-sm font-semibold">🔔 Notifications</h3>
                    {unreadCount > 0 && (
                      <button onClick={() => void markAllRead()} className="text-[10px] text-[var(--color-accent)] hover:underline cursor-pointer">
                        Tout marquer lu
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">
                        Aucune notification
                      </div>
                    ) : (
                      notifications.map(notif => (
                        <div
                          key={notif.id}
                          onClick={() => void handleNotifClick(notif)}
                          className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors border-b border-[var(--color-border-subtle)] last:border-b-0 ${
                            !notif.is_read ? 'bg-[var(--color-accent)]/5' : ''
                          }`}
                        >
                          <span className="text-sm mt-0.5">{notif.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${!notif.is_read ? 'font-semibold' : 'font-medium text-[var(--color-text-secondary)]'}`}>{notif.title}</p>
                            <p className="text-[10px] text-[var(--color-text-muted)] truncate">{notif.description}</p>
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{formatRelativeTime(notif.created_at)}</p>
                          </div>
                          {!notif.is_read && (
                            <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] mt-1.5 shrink-0" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Banner changement mot de passe */}
        {showPwBanner && (
          <div className="bg-[var(--color-warning)]/15 border-b border-[var(--color-warning)]/30 px-4 py-2 flex items-center justify-between text-xs shrink-0 animate-slide-down">
            <span className="text-[var(--color-text-primary)]">
              🔐 Votre mot de passe est temporaire.
              <Link to="/change-password" className="ml-1 font-semibold text-[var(--color-accent)] hover:underline">Changez-le maintenant →</Link>
            </span>
            <button
              onClick={() => { setShowPwBanner(false); localStorage.removeItem('must_change_password'); }}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Contenu de la page */}
        <div className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
          <div className="animate-fade-in">
            {children}
          </div>
        </div>
      </main>

      {/* Command Palette */}
      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
