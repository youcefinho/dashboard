// ── Avatar — initiales + couleur dynamique + image fallback (Sprint 23 — ring) ──
import { cn } from '@/lib/cn';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Sprint 23 — ring branded autour de l'avatar (pour hot leads / actif) */
  ring?: 'hot' | 'active' | 'none';
  className?: string;
}

const sizeMap = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
};

const colors = ['#009DDB', '#D96E27', '#37CA37', '#757BBD', '#E93D3D', '#188BF6', '#FF9A00', '#155EEF'];

export function Avatar({ name, src, size = 'md', ring = 'none', className }: AvatarProps) {
  const initial = (name || '?').charAt(0).toUpperCase();
  // Gradient diagonal au lieu de couleur plate (Sprint 23 — plus de personnalité visuelle)
  const baseColor = colors[name.charCodeAt(0) % colors.length];
  const colorIdx = name.charCodeAt(0) % colors.length;
  const accentColor = colors[(colorIdx + 3) % colors.length];
  const gradient = `linear-gradient(135deg, ${baseColor} 0%, ${accentColor} 100%)`;

  const ringClass = ring === 'hot' ? 'avatar-ring-hot' : ring === 'active' ? 'avatar-ring-active' : '';

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover', sizeMap[size], ringClass, className)}
      />
    );
  }

  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-semibold text-white shrink-0', sizeMap[size], ringClass, className)}
      style={{ background: gradient }}
      title={name}
    >
      {initial}
    </div>
  );
}
