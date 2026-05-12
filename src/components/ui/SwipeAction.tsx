import { useState, useRef, ReactNode, TouchEvent } from 'react';

interface SwipeActionProps {
  children: ReactNode;
  rightActions?: ReactNode;
  leftActions?: ReactNode;
  rightThreshold?: number; // Distance in px to fully open right actions
  leftThreshold?: number;
}

export function SwipeAction({ children, rightActions, leftActions, rightThreshold = 80, leftThreshold = 80 }: SwipeActionProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  
  const startX = useRef(0);
  const currentX = useRef(0);
  const startOffset = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      startX.current = touch.clientX;
    }
    startOffset.current = offset;
    setIsDragging(true);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (touch) {
      currentX.current = touch.clientX;
    }
    const diff = currentX.current - startX.current;
    
    let newOffset = startOffset.current + diff;
    
    // Limits
    if (!rightActions && newOffset < 0) newOffset = 0;
    if (!leftActions && newOffset > 0) newOffset = 0;
    
    // Max stretch
    if (newOffset > leftThreshold + 20) newOffset = leftThreshold + 20;
    if (newOffset < -rightThreshold - 20) newOffset = -rightThreshold - 20;
    
    setOffset(newOffset);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    
    // Snap
    if (offset > leftThreshold / 2 && leftActions) {
      setOffset(leftThreshold);
    } else if (offset < -rightThreshold / 2 && rightActions) {
      setOffset(-rightThreshold);
    } else {
      setOffset(0);
    }
  };

  return (
    <div 
      className="relative overflow-hidden w-full"
      ref={containerRef}
    >
      {/* Actions (Background) */}
      <div className="absolute inset-0 flex items-center justify-between z-0 px-2 pointer-events-none">
        <div className={`h-full flex items-center ${offset > 0 ? 'opacity-100 pointer-events-auto' : 'opacity-0'}`}>
          {leftActions}
        </div>
        <div className={`h-full flex items-center ${offset < 0 ? 'opacity-100 pointer-events-auto' : 'opacity-0'}`}>
          {rightActions}
        </div>
      </div>
      
      {/* Content (Foreground) */}
      <div 
        className="relative z-10 bg-[var(--bg-canvas)]"
        style={{ 
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.1, 0.7, 0.1, 1)'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offset !== 0) setOffset(0); // Click outside actions closes the swipe
        }}
      >
        {children}
      </div>
    </div>
  );
}
