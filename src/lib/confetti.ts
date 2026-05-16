// ── confetti — Burst confetti DOM-only branded (Sprint 23 wave 8) ────────────
// Pas de lib externe. Génère des particules SVG en absolute, anime avec
// requestAnimationFrame, cleanup auto.
// Couleurs : signature Intralys cyan/orange/vert.
//
// Sprint 24 vague 3B — additions :
//   - confettiBurstSubtle()  : 15 particules, 1.4s, gravity normale (micro-celebrations).
//   - confettiBurstHero()    : 80 particules, 3s, gravity 0.6 réduite (Pipeline won, onboarding complete).
//   - confettiBurst() existant conservé pour back-compat (Pipeline, LeadDetail).

interface BurstOptions {
  x?: number;
  y?: number;
  /** Nombre de particules (defaults 50). Réduit si prefers-reduced-motion. */
  count?: number;
  /** Durée totale ms (default 2200). */
  duration?: number;
  /** Gravité appliquée à vy par frame (default 0.35). Réduit pour hero. */
  gravity?: number;
}

const COLORS = ['#009DDB', '#D96E27', '#37CA37', '#FF9A00', '#188BF6'];
const BRAND_COLORS = ['#009DDB', '#D96E27']; // Subset pour subtle

function runBurst(
  options: BurstOptions & { palette: string[]; sizeMin: number; sizeMax: number; velocityMin: number; velocityMax: number }
): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { x, y, count, duration = 2200, gravity = 0.35, palette, sizeMin, sizeMax, velocityMin, velocityMax } = options;

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
  const n = count ?? 50;

  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    const color = palette[Math.floor(Math.random() * palette.length)]!;
    const size = sizeMin + Math.random() * (sizeMax - sizeMin);
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
    const velocity = velocityMin + Math.random() * (velocityMax - velocityMin);
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

/**
 * Burst confetti standard (Sprint 23 wave 8 — préservé pour back-compat).
 * 50 particules, durée 2.2s, gravity 0.35.
 *
 * Usage : confettiBurst() — burst au centre de l'écran
 *         confettiBurst({ x, y }) — burst depuis un point précis (clientX/Y)
 */
export function confettiBurst({ x, y, count = 50 }: BurstOptions = {}): void {
  runBurst({ x, y, count, duration: 2200, gravity: 0.35, palette: COLORS, sizeMin: 6, sizeMax: 14, velocityMin: 8, velocityMax: 20 });
}

/**
 * Sprint 24 vague 3B — Burst subtle pour micro-celebrations (toast `celebrate: true`,
 * smart-list saved, favoris ajouté…).
 * 15 particules brand cyan/orange seulement, durée 1.4s, gravity normale.
 */
export function confettiBurstSubtle({ x, y }: BurstOptions = {}): void {
  runBurst({ x, y, count: 15, duration: 1400, gravity: 0.35, palette: BRAND_COLORS, sizeMin: 5, sizeMax: 9, velocityMin: 6, velocityMax: 12 });
}

/**
 * Sprint 24 vague 3B — Burst hero pour les wins majeurs (Pipeline won,
 * onboarding complété, milestone atteint).
 * 80 particules brand, durée 3s, gravity réduite 0.6 → particules planent plus longtemps.
 */
export function confettiBurstHero({ x, y }: BurstOptions = {}): void {
  runBurst({ x, y, count: 80, duration: 3000, gravity: 0.18, palette: COLORS, sizeMin: 7, sizeMax: 16, velocityMin: 10, velocityMax: 24 });
}
