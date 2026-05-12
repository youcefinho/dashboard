// ── Page Mode Visite Mobile — Intralys CRM (Sprint 6 D6) ────
// Route : /visit/:leadId — layout 1 colonne, gros touch targets

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { Phone, MessageSquare, Mail, StickyNote, Camera, ChevronLeft, CheckCircle, Circle, Star, Zap, MapPin, Clock } from 'lucide-react';
import { takePhoto } from '@/lib/camera';

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  score: number;
  address?: string;
  avatar_url?: string;
  notes?: string;
  client_name?: string;
  deal_value?: number;
  created_at: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: '1', label: 'Confirmer les coordonnées du contact', done: false },
  { id: '2', label: 'Présenter nos services', done: false },
  { id: '3', label: 'Identifier les besoins spécifiques', done: false },
  { id: '4', label: 'Prendre des photos si pertinent', done: false },
  { id: '5', label: 'Confirmer les prochaines étapes', done: false },
  { id: '6', label: 'Envoyer le suivi post-visite', done: false },
];

const STATUS_LABELS: Record<string, string> = {
  new: 'Nouveau', contacted: 'Contacté', qualified: 'Qualifié',
  inbound: 'Entrant', customer: 'Client', won: 'Gagné', lost: 'Perdu',
};

export function VisitModePage() {
  const { leadId } = useParams({ from: '/visit/$leadId' });
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => {
    try {
      const saved = localStorage.getItem(`visit_checklist_${leadId}`);
      return saved ? JSON.parse(saved) as ChecklistItem[] : DEFAULT_CHECKLIST;
    } catch { return DEFAULT_CHECKLIST; }
  });
  const [note, setNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Charger le lead
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/leads/${leadId}`);
        const json = await res.json() as { data?: Lead };
        if (json.data) {
          setLead(json.data);
          setStatus(json.data.status);
        }
      } catch { /* silencieux */ }
      setIsLoading(false);
    }
    void load();
  }, [leadId]);

  // Persister checklist
  useEffect(() => {
    localStorage.setItem(`visit_checklist_${leadId}`, JSON.stringify(checklist));
  }, [checklist, leadId]);

  const toggleCheck = (id: string) => {
    setChecklist(prev => prev.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  const completedCount = checklist.filter(c => c.done).length;
  const progress = Math.round((completedCount / checklist.length) * 100);

  const saveNote = async () => {
    if (!note.trim() || !lead) return;
    setIsSavingNote(true);
    try {
      await fetch(`/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: note, note_type: 'visit' }),
      });
      setNote('');
      setShowNoteInput(false);
    } catch { /* silencieux */ }
    setIsSavingNote(false);
  };

  const handlePhotoCapture = async () => {
    const photo = await takePhoto();
    if (photo) {
      setPhotos(prev => [...prev, photo.dataUrl]);
      // En production : upload vers R2 via /api/files
    }
  };

  // Fallback legacy input file (garder pour compatibilité)
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotos(prev => [...prev, url]);
  };

  const updateStatus = async (newStatus: string) => {
    setStatus(newStatus);
    await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const scoreColor = (score: number) =>
    score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-white text-lg">Lead introuvable</p>
        <button onClick={() => void navigate({ to: '/leads' })} className="text-indigo-400 underline">
          Retour aux leads
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => void navigate({ to: '/leads' })}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 active:scale-95 transition-all">
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg truncate">{lead.name}</h1>
            <p className="text-xs text-gray-400 truncate">{lead.client_name || 'Mode visite'}</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
            style={{ background: scoreColor(lead.score) + '20', color: scoreColor(lead.score) }}>
            <Zap size={12} />
            {lead.score}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32">
        {/* Infos contact */}
        <div className="px-4 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-bold shrink-0">
              {lead.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-base">{lead.name}</p>
              {lead.email && <p className="text-sm text-gray-400 truncate">{lead.email}</p>}
              {lead.address && (
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin size={10} /> {lead.address}
                </p>
              )}
            </div>
          </div>

          {/* Deal value */}
          {(lead.deal_value ?? 0) > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <Star size={14} className="text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-400">
                {lead.deal_value!.toLocaleString('fr-CA')} $
              </span>
            </div>
          )}

          {/* Timestamp */}
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Clock size={10} />
            Créé {new Date(lead.created_at).toLocaleDateString('fr-CA')}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-4 border-b border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Actions rapides</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {lead.phone && (
              <a href={`tel:${lead.phone}`}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-500/10 border border-green-500/20 active:scale-95 transition-all">
                <Phone size={22} className="text-green-400" />
                <span className="text-[10px] text-green-400 font-medium">Appeler</span>
              </a>
            )}
            {lead.phone && (
              <a href={`sms:${lead.phone}`}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 active:scale-95 transition-all">
                <MessageSquare size={22} className="text-blue-400" />
                <span className="text-[10px] text-blue-400 font-medium">SMS</span>
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 active:scale-95 transition-all">
                <Mail size={22} className="text-purple-400" />
                <span className="text-[10px] text-purple-400 font-medium">Email</span>
              </a>
            )}
            <button onClick={() => setShowNoteInput(p => !p)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 active:scale-95 transition-all">
              <StickyNote size={22} className="text-orange-400" />
              <span className="text-[10px] text-orange-400 font-medium">Note</span>
            </button>
          </div>
        </div>

        {/* Note rapide */}
        {showNoteInput && (
          <div className="px-4 py-4 border-b border-gray-800 bg-gray-900/50">
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note de visite..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-indigo-500"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setShowNoteInput(false); setNote(''); }}
                className="flex-1 py-2 rounded-lg text-sm text-gray-400 bg-gray-800 active:scale-95">
                Annuler
              </button>
              <button onClick={() => void saveNote()} disabled={!note.trim() || isSavingNote}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 disabled:opacity-50 active:scale-95">
                {isSavingNote ? '...' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        )}

        {/* Checklist visite */}
        <div className="px-4 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Checklist visite
            </p>
            <span className="text-xs text-indigo-400 font-semibold">{completedCount}/{checklist.length}</span>
          </div>
          {/* Barre de progression */}
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden mb-4">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
              style={{ width: `${progress}%` }} />
          </div>
          <div className="space-y-2">
            {checklist.map(item => (
              <button key={item.id} onClick={() => toggleCheck(item.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-98 text-left ${
                  item.done
                    ? 'border-green-500/30 bg-green-500/10'
                    : 'border-gray-700 bg-gray-800/50'
                }`}>
                {item.done
                  ? <CheckCircle size={20} className="text-green-400 shrink-0" />
                  : <Circle size={20} className="text-gray-500 shrink-0" />
                }
                <span className={`text-sm ${item.done ? 'text-green-300 line-through opacity-70' : 'text-white'}`}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Photos */}
        <div className="px-4 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Photos</p>
            <button onClick={() => void handlePhotoCapture()}
              className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium active:scale-95">
              <Camera size={14} />
              Ajouter
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileInput}
          />
          {photos.length === 0 ? (
            <button onClick={() => void handlePhotoCapture()}
              className="w-full border-2 border-dashed border-gray-700 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-500 active:scale-98">
              <Camera size={28} />
              <span className="text-sm">Prendre ou importer une photo</span>
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((url, i) => (
                <img key={i} src={url} alt={`Photo ${i + 1}`}
                  className="w-full aspect-square object-cover rounded-lg" />
              ))}
              <button onClick={() => fileInputRef.current?.click()}
                className="aspect-square border-2 border-dashed border-gray-700 rounded-lg flex items-center justify-center text-gray-500 active:scale-95">
                <Camera size={20} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-gray-900/95 backdrop-blur border-t border-gray-800 px-4 py-3 z-20">
        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={e => void updateStatus(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => void navigate({ to: '/leads' })}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold text-white active:scale-95 transition-all whitespace-nowrap"
          >
            Terminer ✓
          </button>
        </div>
        {/* Progress mini */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] text-gray-500">{progress}%</span>
        </div>
      </div>
    </div>
  );
}
