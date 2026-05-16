// ── MessageAttachment — Sprint 26 vague 26-1B ────────────────────────────────
// Attachments inline pour MessageBubble : images (zoom modal) / files (download)
// / audio (waveform player simple).
//
// Layout grid 1-2 cols selon nombre d'attachments.
// Tone "on-brand" inverse les couleurs pour s'inscrire sur bubble gradient sent.

import { useState } from 'react';
import { Download, File, FileText, FileImage, Music, Play, Pause } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';

export type AttachmentKind = 'image' | 'file' | 'audio';

export interface Attachment {
  kind: AttachmentKind;
  /** URL ou data URI */
  url: string;
  /** Nom fichier (affiché + a11y) */
  name: string;
  /** Taille fichier (ex: "1.2 MB") */
  size?: string;
  /** Type MIME (ex: "application/pdf") — utilisé pour icon file */
  mime?: string;
  /** Durée audio en secondes (audio only) */
  duration?: number;
}

interface Props {
  attachments: Attachment[];
  /** "on-brand" = bulle gradient cyan→orange (texte blanc) ; "on-surface" = bulle blanche. */
  tone?: 'on-brand' | 'on-surface';
}

export function MessageAttachment({ attachments, tone = 'on-surface' }: Props) {
  // Grid : 1 col si 1, 2 cols si ≥2
  const cols = attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2';

  return (
    <div className={`grid ${cols} gap-2`}>
      {attachments.map((att, i) => {
        if (att.kind === 'image') {
          return <ImageAttachment key={i} att={att} />;
        }
        if (att.kind === 'audio') {
          return <AudioAttachment key={i} att={att} tone={tone} />;
        }
        return <FileAttachmentChip key={i} att={att} tone={tone} />;
      })}
    </div>
  );
}

// ── Image attachment (zoom modal) ────────────────────────────────────────────
function ImageAttachment({ att }: { att: Attachment }) {
  const [zoomOpen, setZoomOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomOpen(true)}
        className="msg-attach-image relative overflow-hidden rounded-xl block w-full"
        style={{ height: 160, maxWidth: 240 }}
        aria-label={`Image ${att.name} — cliquer pour agrandir`}
      >
        <img
          src={att.url}
          alt={att.name}
          className="w-full h-full object-cover transition-transform duration-300"
          draggable={false}
        />
      </button>
      <Modal open={zoomOpen} onOpenChange={setZoomOpen} title={att.name} size="lg">
        <div className="flex items-center justify-center p-4">
          <img
            src={att.url}
            alt={att.name}
            className="max-w-full max-h-[75vh] rounded-lg object-contain"
            draggable={false}
          />
        </div>
      </Modal>
    </>
  );
}

// ── File chip (download) ─────────────────────────────────────────────────────
function FileAttachmentChip({ att, tone }: { att: Attachment; tone: 'on-brand' | 'on-surface' }) {
  // Choix icon selon mime
  let FileIcon = File;
  if (att.mime?.startsWith('image/')) FileIcon = FileImage;
  else if (att.mime?.includes('pdf') || att.mime?.startsWith('text/')) FileIcon = FileText;

  const handleClick = () => {
    // Stub : déclenche download via lien hidden
    const a = document.createElement('a');
    a.href = att.url;
    a.download = att.name;
    a.click();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`msg-attach-file ${tone === 'on-brand' ? 'msg-attach-file--on-brand' : ''}`}
      aria-label={`Télécharger ${att.name}`}
    >
      <span className="msg-attach-file-icon">
        <Icon as={FileIcon} size="md" />
      </span>
      <span className="msg-attach-file-meta">
        <span className="msg-attach-file-name truncate">{att.name}</span>
        {att.size && <span className="msg-attach-file-size t-mono-num">{att.size}</span>}
      </span>
      <span className="msg-attach-file-dl">
        <Icon as={Download} size="sm" />
      </span>
    </button>
  );
}

// ── Audio attachment (simple waveform + play) ────────────────────────────────
function AudioAttachment({ att, tone }: { att: Attachment; tone: 'on-brand' | 'on-surface' }) {
  const [playing, setPlaying] = useState(false);
  const formatDur = (s?: number) => {
    if (!s) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Waveform SVG fake — 24 barres pseudo-random déterministes
  const bars = Array.from({ length: 24 }, (_, i) => {
    const h = 4 + ((Math.sin(i * 1.3) + 1) / 2) * 18 + ((i * 7) % 5);
    return Math.min(22, h);
  });

  return (
    <div className={`msg-attach-audio ${tone === 'on-brand' ? 'msg-attach-audio--on-brand' : ''}`}>
      <button
        type="button"
        onClick={() => setPlaying(p => !p)}
        className="msg-attach-audio-play"
        aria-label={playing ? 'Pause audio' : 'Lire audio'}
      >
        <Icon as={playing ? Pause : Play} size="sm" />
      </button>
      <svg
        viewBox="0 0 120 22"
        className="msg-attach-audio-wave"
        preserveAspectRatio="none"
        aria-hidden
      >
        {bars.map((h, i) => (
          <rect
            key={i}
            x={i * 5}
            y={(22 - h) / 2}
            width={3}
            height={h}
            rx={1.5}
          />
        ))}
      </svg>
      <span className="msg-attach-audio-meta">
        <Icon as={Music} size="xs" />
        <span className="t-mono-num text-[10px] font-medium">{formatDur(att.duration)}</span>
      </span>
    </div>
  );
}
