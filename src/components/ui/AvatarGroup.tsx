// ── AvatarGroup — stack horizontal d'avatars avec overlap (Sprint 23 wave 26) ─
import { forwardRef, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { Avatar, type AvatarSize, type AvatarStatus } from './Avatar';
import { Tooltip } from './Tooltip';

export interface AvatarGroupItem {
  name: string;
  src?: string;
  status?: AvatarStatus;
  tooltip?: string;
}

interface AvatarGroupProps {
  avatars: AvatarGroupItem[];
  /** Nb max d'avatars visibles — défaut 4 (le reste devient +X) */
  max?: number;
  size?: AvatarSize;
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
}

// Overlap par taille — négatif = chevauchement
const overlapMap: Record<AvatarSize, number> = {
  xs: -6,
  sm: -8,
  md: -10,
  lg: -14,
  xl: -18,
};

// Cascade translateX au hover (px par index)
const cascadeStep: Record<AvatarSize, number> = {
  xs: 3,
  sm: 4,
  md: 5,
  lg: 6,
  xl: 8,
};

const plusSizeMap: Record<AvatarSize, string> = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-14 h-14 text-sm',
  xl: 'w-20 h-20 text-base',
};

export const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(function AvatarGroup(
  { avatars, max = 4, size = 'sm', onClick, className, 'aria-label': ariaLabel },
  ref,
) {
  const total = avatars.length;
  const visible = avatars.slice(0, max);
  const extra = Math.max(0, total - visible.length);

  const overlap = overlapMap[size];
  const step = cascadeStep[size];

  const interactive = typeof onClick === 'function';

  const groupLabel = ariaLabel ?? `${total} membre${total > 1 ? 's' : ''}`;

  return (
    <div
      ref={ref}
      role="group"
      aria-label={groupLabel}
      onClick={onClick}
      className={cn(
        'avatar-group inline-flex items-center',
        interactive && 'cursor-pointer',
        className,
      )}
    >
      {visible.map((a, i) => {
        const cascadeOffset = i * step;
        const itemStyle: CSSProperties = {
          marginLeft: i === 0 ? 0 : overlap,
          // Variable CSS consommée par .avatar-group:hover .avatar-group-item
          ['--avatar-cascade' as never]: `${cascadeOffset}px`,
          zIndex: visible.length - i,
          position: 'relative',
        };

        return (
          <span key={`${a.name}-${i}`} className="avatar-group-item" style={itemStyle}>
            <Avatar
              name={a.name}
              src={a.src}
              size={size}
              status={a.status}
              tooltip={a.tooltip ?? a.name}
              bordered
            />
          </span>
        );
      })}

      {extra > 0 && (
        <PlusBadge
          count={extra}
          totalCount={total}
          size={size}
          overlap={overlap}
          cascadeOffset={visible.length * step}
          zIndex={0}
        />
      )}
    </div>
  );
});

interface PlusBadgeProps {
  count: number;
  totalCount: number;
  size: AvatarSize;
  overlap: number;
  cascadeOffset: number;
  zIndex: number;
}

function PlusBadge({ count, totalCount, size, overlap, cascadeOffset, zIndex }: PlusBadgeProps) {
  const style: CSSProperties = {
    marginLeft: overlap,
    ['--avatar-cascade' as never]: `${cascadeOffset}px`,
    zIndex,
    position: 'relative',
    background:
      'linear-gradient(135deg, rgba(0,157,219,0.14) 0%, rgba(217,110,39,0.14) 100%)',
    border: '1.5px solid rgba(0,157,219,0.45)',
    boxShadow:
      '0 0 0 2px var(--bg-canvas, #FAFBFC), 0 2px 6px rgba(0,157,219,0.18)',
    color: '#0F6FA6',
  };

  return (
    <Tooltip content={`Voir tous les ${totalCount} membres`}>
      <span
        className={cn(
          'avatar-group-item rounded-full flex items-center justify-center font-bold shrink-0 select-none',
          plusSizeMap[size],
        )}
        style={style}
        aria-label={`Plus ${count} membres`}
      >
        +{count}
      </span>
    </Tooltip>
  );
}
