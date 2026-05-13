// ── AnimatedNumber — Count-up branded pour stat numbers (Sprint 23 wave 8) ──
// Extrait le nombre d'une valeur (peut être "1,247" ou "12.5K $" ou 1247),
// anime de 0 → ce nombre, et re-formatte avec le suffixe/préfixe.

import { useCountUp } from '@/lib/useCountUp';

interface AnimatedNumberProps {
  /** Valeur cible. Si string, on extrait les chiffres et garde le reste comme suffixe. */
  value: number | string;
  /** Durée en ms */
  duration?: number;
  /** Format custom : (val) => string. Par défaut, locale fr-CA. */
  format?: (val: number) => string;
  className?: string;
}

function defaultFormat(n: number): string {
  return Math.round(n).toLocaleString('fr-CA');
}

export function AnimatedNumber({ value, duration = 1200, format = defaultFormat, className }: AnimatedNumberProps) {
  // Si value est un string, on extrait le nombre principal et le suffixe
  let numericTarget: number;
  let prefix = '';
  let suffix = '';

  if (typeof value === 'number') {
    numericTarget = value;
  } else {
    const match = value.match(/^(\D*)([\d,.\s]+)(.*)$/);
    if (match) {
      prefix = match[1] || '';
      const numStr = (match[2] || '0').replace(/[\s,]/g, '').replace(',', '.');
      numericTarget = parseFloat(numStr) || 0;
      suffix = match[3] || '';
    } else {
      numericTarget = 0;
      suffix = value;
    }
  }

  const { value: animated, ref } = useCountUp(numericTarget, { duration });

  // Si la cible est 0 ou string non-numérique, on affiche tel quel
  if (numericTarget === 0 && typeof value === 'string') {
    return <span ref={ref as React.RefObject<HTMLSpanElement>} className={className}>{value}</span>;
  }

  return (
    <span ref={ref as React.RefObject<HTMLSpanElement>} className={className}>
      {prefix}{format(animated)}{suffix}
    </span>
  );
}
