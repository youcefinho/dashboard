// ── AppLayout — Layout principal (Sprint Design) ────────────

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useNavigate, Link } from '@tanstack/react-router';
import { CommandPalette } from '@/components/CommandPalette';
import { useTheme } from '@/lib/useTheme';
import { getNotifications, markNotificationRead, markAllNotificationsRead, type NotificationItem } from '@/lib/api';
import { Search, Bell, Moon, Sun, Menu, Plus } from 'lucide-react';
import { MobileBottomNav } from './MobileBottomNav';
import { InstallPrompt } from '../InstallPrompt';
import { OnboardingWizard } from '../onboarding/OnboardingWizard';
import { FeedbackWidget } from '../feedback/FeedbackWidget';
import { NpsModal } from '../feedback/NpsModal';
import { useAuth } from '@/lib/auth';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
}

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
  const { user } = useAuth();
  
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return user?.onboarding_step === 0 && !user?.onboarding_skipped;
  });

  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ limit: 20 });
      if (res.data) setNotifications(res.data);
      const raw = res as Record<string, unknown>;
      if (typeof raw.unread_count === 'number') setUnreadCount(raw.unread_count);
      else if (res.data) setUnreadCount(res.data.filter(n => !n.is_read).length);
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => { void loadNotifications(); }, 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

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

      <main className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-canvas)]">
        {/* Header — sticky 56px, fond blanc */}
        <header className="h-14 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between px-4 lg:px-6 shrink-0 sticky top-0 z-30">
          {/* Gauche : hamburger + titre */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
            >
              <Menu size={20} />
            </button>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{title}</h2>
          </div>

          {/* Centre : search global */}
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-subtle)] hover:bg-[var(--bg-muted)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs text-[var(--text-muted)] w-48 lg:w-80 cursor-pointer transition-colors"
          >
            <Search size={14} />
            <span>Rechercher...</span>
            <span className="ml-auto text-[10px] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">⌘K</span>
          </button>

          {/* Droite : actions */}
          <div className="flex items-center gap-1">
            {/* Search mobile */}
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden p-1.5 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
            >
              <Search size={18} />
            </button>

            {/* Bouton + Nouveau */}
            <button
              onClick={() => void navigate({ to: '/leads' })}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-4 text-sm font-semibold rounded-lg text-white active:scale-[0.98] transition-all cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #009DDB 0%, #188BF6 100%)', boxShadow: '0 1px 2px rgba(0,157,219,0.2), 0 0 0 1px rgba(0,157,219,0.05)' }}
            >
              <Plus size={14} />
              Nouveau
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-1.5 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[var(--danger)] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Dropdown notifications */}
              {notifOpen && (
                <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-[var(--shadow-popover)] z-50 overflow-hidden animate-slide-down">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>
                    {unreadCount > 0 && (
                      <button onClick={() => void markAllRead()} className="text-[10px] text-[var(--brand-primary)] hover:underline cursor-pointer">
                        Tout marquer lu
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                        Aucune notification
                      </div>
                    ) : (
                      notifications.map(notif => (
                        <div
                          key={notif.id}
                          onClick={() => void handleNotifClick(notif)}
                          className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-subtle)] transition-colors border-b border-[var(--border-subtle)] last:border-b-0 ${
                            !notif.is_read ? 'bg-[var(--brand-tint)]' : ''
                          }`}
                        >
                          <span className="text-sm mt-0.5">{notif.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${!notif.is_read ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>{notif.title}</p>
                            <p className="text-[10px] text-[var(--text-muted)] truncate">{notif.description}</p>
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatRelativeTime(notif.created_at)}</p>
                          </div>
                          {!notif.is_read && (
                            <div className="w-2 h-2 rounded-full bg-[var(--brand-primary)] mt-1.5 shrink-0" />
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
          <div className="bg-[var(--warning-soft)] border-b border-[var(--warning)]/30 px-4 py-2 flex items-center justify-between text-xs shrink-0 animate-slide-down">
            <span className="text-[var(--text-primary)]">
              🔐 Votre mot de passe est temporaire.
              <Link to="/change-password" className="ml-1 font-semibold text-[var(--brand-primary)] hover:underline">Changez-le maintenant →</Link>
            </span>
            <button
              onClick={() => { setShowPwBanner(false); localStorage.removeItem('must_change_password'); }}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >✕</button>
          </div>
        )}

        {/* Contenu de la page */}
        <div className="flex-1 overflow-auto p-4 lg:p-8">
          <div className="animate-fade-in max-w-[1400px]">
            {children}
          </div>
        </div>
      </main>

      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
      <MobileBottomNav />
      <InstallPrompt />
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <FeedbackWidget />
      <NpsModal />
    </div>
  );
}
