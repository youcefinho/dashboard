// ── confetti — Burst confetti DOM-only branded (Sprint 23 wave 8) ────────────
// Pas de lib externe. Génère 50 particules SVG en absolute, anime avec
// requestAnimationFrame, cleanup auto après 2.5s.
// Couleurs : signature Intralys cyan/orange/vert.
//
// Usage : confettiBurst() — burst au centre de l'écran
//         confettiBurst({ x, y }) — burst depuis un point précis (clientX/Y)

interface BurstOptions {
  x?: number;
  y?: number;
  /** Nombre de particules (defaults 50). Réduit si prefers-reduced-motion. */
  count?: number;
}

const COLORS = ['#009DDB', '#D96E27', '#37CA37', '#FF9A00', '#188BF6'];

export function confettiBurst({ x, y, count = 50 }: BurstOptions = {}): void {
  if (typeof document === 'undefined') return;
  // Respect reduced motion : skip animation entirely
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const cx = x ?? window.innerWidth / 2;
  const cy = y ?? window.innerHeight / 2;

  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 9999;
    overflow: hidden;
  `;
  document.body.appendChild(container);

  const particles: Array<{ el: HTMLElement; vx: number; vy: number; vr: number; x: number; y: number; r: number; opacity: number }> = [];

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
    const size = 6 + Math.random() * 8;
    const isCircle = Math.random() > 0.5;
    el.style.cssText = `
      position: absolute;
      left: ${cx}px;
      top: ${cy}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      box-shadow: 0 0 8px ${color}80;
      transform-origin: center;
      will-change: transform, opacity;
    `;
    container.appendChild(el);

    const angle = Math.random() * Math.PI * 2;
    const velocity = 8 + Math.random() * 12;
    particles.push({
      el,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - 4, // bias upward
      vr: (Math.random() - 0.5) * 20,
      x: 0,
      y: 0,
      r: 0,
      opacity: 1,
    });
  }

  const start = performance.now();
  const duration = 2200;
  const gravity = 0.35;

  function tick(now: number) {
    const elapsed = now - start;
    const t = elapsed / duration;

    particles.forEach(p => {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      p.opacity = Math.max(0, 1 - t * 1.2);
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.r}deg)`;
      p.el.style.opacity = String(p.opacity);
    });

    if (elapsed < duration) {
      requestAnimationFrame(tick);
    } else {
      container.remove();
    }
  }
  requestAnimationFrame(tick);
}
