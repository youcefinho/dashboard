// ── Avatar — initiales + couleur dynamique + image fallback ──
import { cn } from '@/lib/cn';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
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

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const bgColor = colors[name.charCodeAt(0) % colors.length];

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover', sizeMap[size], className)}
      />
    );
  }

  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-semibold text-white shrink-0', sizeMap[size], className)}
      style={{ backgroundColor: bgColor }}
      title={name}
    >
      {initial}
    </div>
  );
}
