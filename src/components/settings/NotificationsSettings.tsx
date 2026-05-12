import { useState, useEffect } from 'react';
import { Card, useToast } from '@/components/ui';
import { getNotificationPreferences, updateNotificationPreference, type NotificationPreference } from '@/lib/api';
import { Bell, Mail, Smartphone, Monitor } from 'lucide-react';

export function NotificationsSettings() {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const { success, error: toastError } = useToast();

  useEffect(() => {
    getNotificationPreferences().then(res => {
      if (res.data) setPreferences(res.data);
      setLoading(false);
    });
  }, []);

  const togglePref = async (channel: 'email' | 'sms' | 'push' | 'in_app', eventType: string, currentEnabled: boolean) => {
    // Optimistic update
    const nextEnabled = !currentEnabled;
    const isNew = !preferences.find(p => p.channel === channel && p.event_type === eventType);
    
    if (isNew) {
      setPreferences(prev => [...prev, { channel, event_type: eventType, enabled: nextEnabled ? 1 : 0 }]);
    } else {
      setPreferences(prev => prev.map(p => 
        (p.channel === channel && p.event_type === eventType) ? { ...p, enabled: nextEnabled ? 1 : 0 } : p
      ));
    }

    const res = await updateNotificationPreference(channel, eventType, nextEnabled);
    if (res.error) {
      toastError(res.error);
      // Revert on error
      setPreferences(prev => prev.map(p => 
        (p.channel === channel && p.event_type === eventType) ? { ...p, enabled: currentEnabled ? 1 : 0 } : p
      ));
    } else {
      success('Préférences mises à jour');
    }
  };

  const isEnabled = (channel: string, eventType: string) => {
    const pref = preferences.find(p => p.channel === channel && p.event_type === eventType);
    // Defaults: Email enabled, others disabled
    return pref ? pref.enabled === 1 : (channel === 'email' || channel === 'in_app');
  };

  const events = [
    { id: 'lead.created', label: 'Nouveau lead', desc: 'Quand un prospect soumet un formulaire' },
    { id: 'message.received', label: 'Nouveau message', desc: 'Quand un lead vous répond' },
    { id: 'task.overdue', label: 'Tâche en retard', desc: 'Rappel quotidien des tâches' },
    { id: 'workflow.error', label: 'Erreur workflow', desc: 'Alerte technique' }
  ];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="text-base font-semibold mb-2 flex items-center gap-2">
          <Bell size={18} className="text-[var(--brand-primary)]" />
          Préférences de notifications
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          Choisissez comment vous souhaitez être alerté pour chaque type d'événement.
        </p>

        <div className="space-y-6">
          <div className="grid grid-cols-[1fr_80px_80px_80px] gap-4 pb-2 border-b border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)]">
            <div>Événement</div>
            <div className="text-center flex flex-col items-center gap-1"><Monitor size={14}/> In-App</div>
            <div className="text-center flex flex-col items-center gap-1"><Mail size={14}/> Email</div>
            <div className="text-center flex flex-col items-center gap-1"><Smartphone size={14}/> SMS</div>
          </div>

          {events.map(event => (
            <div key={event.id} className="grid grid-cols-[1fr_80px_80px_80px] gap-4 items-center">
              <div>
                <p className="text-sm font-medium">{event.label}</p>
                <p className="text-xs text-[var(--text-muted)]">{event.desc}</p>
              </div>
              
              <div className="flex justify-center">
                <input 
                  type="checkbox" 
                  checked={isEnabled('in_app', event.id)}
                  onChange={() => togglePref('in_app', event.id, isEnabled('in_app', event.id))}
                  disabled={loading}
                  className="w-4 h-4 rounded text-[var(--brand-primary)] border-[var(--border-strong)] focus:ring-[var(--brand-primary)]"
                />
              </div>
              <div className="flex justify-center">
                <input 
                  type="checkbox" 
                  checked={isEnabled('email', event.id)}
                  onChange={() => togglePref('email', event.id, isEnabled('email', event.id))}
                  disabled={loading}
                  className="w-4 h-4 rounded text-[var(--brand-primary)] border-[var(--border-strong)] focus:ring-[var(--brand-primary)]"
                />
              </div>
              <div className="flex justify-center">
                <input 
                  type="checkbox" 
                  checked={isEnabled('sms', event.id)}
                  onChange={() => togglePref('sms', event.id, isEnabled('sms', event.id))}
                  disabled={loading}
                  className="w-4 h-4 rounded text-[var(--brand-primary)] border-[var(--border-strong)] focus:ring-[var(--brand-primary)]"
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
