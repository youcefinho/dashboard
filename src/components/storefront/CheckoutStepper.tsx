// ── Storefront — CheckoutStepper (LOT STOREFRONT CHECKOUT, Sprint 7, NEUF) ───
//
// Barre de progression sobre du tunnel checkout — owned Manager-C. Les libellés
// d'étapes sont fournis par le parent (PublicCheckout.tsx) à partir des clés
// FIGÉES Phase A (checkout.* / store.*) — ce composant N'INVENTE aucun texte.
// AUCUN nouveau CSS global : Tailwind + styles inline locaux.

export function CheckoutStepper({
  steps,
  current,
}: {
  steps: string[];
  current: number; // index 0-based de l'étape active
}) {
  return (
    <ol className="flex items-center gap-2" aria-label="progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={i} className="flex flex-1 items-center gap-2 min-w-0">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{
                background: done || active ? 'var(--primary)' : '#e5e7eb',
                color: done || active ? '#fff' : '#6b7280',
              }}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className="truncate text-xs"
              style={{
                color: active ? 'var(--text-primary)' : '#9ca3af',
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span
                className="hidden sm:block flex-1"
                style={{ height: 1, background: '#e5e7eb' }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
