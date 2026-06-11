# LOT 3 — Sprint 29 : a11y AAA + convergence design

> Doc contrat §6 figé. PAS de migration (a11y + design = frontend). Manifest reste à seq124.

## Objectif

Sprint 29 = polish ciblé sur un socle WCAG déjà très mature (Sprint 32/33/34/38/48 ont livré tokens AAA body text + 148 focus-visible + 436 aria-label + 40+ reduced-motion + skip-link inline + forced-colors). Sprint 29 ferme 7 gaps précis et livre la déclaration publique.

## État actuel (audit Chaman 2026-05-23)

### Contraste couleurs — AAA déjà OK pour body text
- `--text-muted: #525866` → 7.37:1 AAA
- `--text-link: #4338CA` → 7.34:1 AAA
- `--text-primary: var(--gray-900) #1A1F36` → 17.8:1 AAA
- `--text-secondary: var(--gray-600) #4F566B` → 7.30:1 AAA
- 4 tokens `--{success/warning/danger/info}-text` AAA-pairs définis (Sprint 48)

### Focus visible — couverture solide
- Règle globale `:focus-visible` dans `src/index.css:283-286`
- Utility `.focus-aaa` dans `src/index.css:11015-11019`
- 148 occurrences `focus-visible:` / `focus-aaa` dans `src/index.css`
- Primitives couvertes : Button, Card, Input, Select, Switch, Toast, Tabs, KpiStrip, Avatar, ColorSwatch
- Forced-colors Windows HCM supporté

### ARIA coverage — massive (Sprint 32-34-48)
- 436 occurrences `aria-label=` dans 151 fichiers
- SlidePanel + Modal → Radix DialogPrimitive `role="dialog"` + `aria-modal` natifs
- Toast `role="status"|"alert"` + `aria-live="polite"`
- EmptyState `role="status"` + `aria-live="polite"`
- Sidebar `<nav aria-label>` + `aria-current="page"`
- AppLayout skip-link `<a href="#main-content">` + `<div id="main-content" tabIndex={-1}>`
- CommandPalette combobox-listbox pattern W3C complet
- Wizard `<ol aria-label="Progression">` + `aria-current="step"`

### prefers-reduced-motion — 40+ blocs ciblés
- Sidebar live-dot, dashboard cards, calendar events, msg bubbles, marketing cards, blog, AI insights, beta widgets, module cards, shop chips
- `Button.tsx:59-62` check JS `prefersReducedMotion()` pour ripple/confetti

### Touch targets — gap WCAG 2.5.5 AAA (44×44)
- Button.tsx sizes : sm h-8 (32px) FAIL / md h-9 (36px) FAIL / lg h-10 (40px) FAIL
- Décision Sprint 29 : `@media (pointer: coarse)` → forcer 44px UNIQUEMENT touch (préserve Stripe-clean desktop)

### Skip links — inline dans AppLayout
- `AppLayout.tsx:629` skip-link + `:911` target visible au focus
- `Landing.tsx:588` `.mkt-skip-link` séparé pages marketing
- GAP : pas un composant standalone réutilisable pour pages publiques (PublicForm, PublicReview, etc.)

## 7 axes Sprint 29 (gaps fermés)

1. **Doc audit** (cette doc) + récap consolidé Sprint 32-48-29
2. **Doc ACCESSIBILITY.md** publique pour conformité Loi 25 PL64 QC + AODA Canada
3. **CSS catchall reduced-motion** : safety net `*, *::before, *::after` en complément des règles ciblées
4. **CSS touch-target AAA mobile** : `@media (pointer: coarse)` min-h 44px sur Button sm/md/lg (mobile only, préserve desktop)
5. **Icon.tsx aria-hidden default** : `aria-hidden="true"` par défaut, override-able via `aria-label` ou `aria-hidden={false}`
6. **Badge.tsx soft variants AAA tokens** : `text-[var(--success-text)]` au lieu de `text-[var(--success)]` raw → ratio 3.40:1 → 7.18:1 AAA
7. **SkipToContent.tsx standalone** : composant reusable pour pages publiques hors AppLayout
8. **i18n 12 clés a11y** × 4 catalogues (skip nav, statement title/link, report issue, badge SR labels, loading, dialog close, menu more)
9. **Test a11y-primitives-sprint29** : vérif aria-label close buttons, role="dialog", Icon aria-hidden default, Badge soft AAA token

## Hors-scope (renvoyé Sprint 30 RC ou backlog)

- Audit axe-core/Lighthouse complet automatisé → Sprint 30 RC
- Color blindness simulation → backlog
- RTL support arabe/hébreu → backlog
- Refonte primitives Button.tsx sizes / Card padding / Modal layout → PRÉSERVE STRIPE-CLEAN
- Charts `<figcaption>` data textuel → backlog (gros chantier)
- Maps Mapbox markers aria-label → backlog
- Reports DashboardBuilder `role="grid"` → backlog
- Refonte couleurs status (`--success/warning/danger` HEX) → INCHANGÉ Stripe
- Audit clavier exhaustif Tab order toutes pages → Sprint 30 RC
- Tests SR réels VoiceOver/NVDA → Sprint 30 RC validation
- Touch-target 44px sur TOUS composants → juste Button mobile-only
- Migration `text-[var(--success)]` body inline cross-pages → backlog low priority
- FocusTrap custom (Radix gère déjà via DialogPrimitive)
- Skip-links sur chaque page publique → juste SkipToContent reusable

## §6 Contrats figés

### 6.1 (cette doc)

### 6.2 Doc ACCESSIBILITY.md publique
- Engagement WCAG 2.2 AA atteint + AAA partiel (body text + focus + reduce-motion + forced-colors)
- Standards : WCAG 2.2, RGAA 4.1, AODA Canada, Loi 25 PL64 QC
- Features supportées (clavier, screen readers, focus AAA, reduce-motion, forced-colors Windows HCM, skip-link, ARIA landmarks)
- Limitations connues (charts data textuel partiel, maps markers SR)
- Process signalement : email `accessibilite@intralys.com`
- Date revue : Sprint 29

### 6.3 CSS patches `src/index.css` (APPEND-ONLY)
- Catchall reduced-motion `*, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; ... }`
- Touch-target `@media (pointer: coarse)` min-h 44px sur button/[role="button"]/a[role="button"] avec opt-outs (link, h-11, h-12)

### 6.4 Icon.tsx patch
- `aria-hidden="true"` par défaut
- Override via `aria-label` (label présent ⇒ aria-hidden false implicite)
- Override explicite via `aria-hidden={false}` prop

### 6.5 Badge.tsx patch (soft + outline variants)
- `success.soft` : `text-[var(--success-text)]` (AAA 7.18:1)
- `warning.soft` : `text-[var(--warning-text)]`
- `danger.soft` : `text-[var(--danger-text)]`
- `info.soft` : `text-[var(--info-text)]`
- `outline` variants idem
- `solid` variants INCHANGÉS (white on bright bg = AAA OK)
- `neutral` + `brand` INCHANGÉS

### 6.6 SkipToContent.tsx (NEUF)
```tsx
export interface SkipToContentProps {
  targetId?: string;
  label?: string;
}
export function SkipToContent(props: SkipToContentProps): JSX.Element;
```
Réutilise `.skip-link` CSS existante. Export dans `src/components/ui/index.ts`.

### 6.7 i18n a11y keys (12 × 4 = 48 entrées)
- `a11y.skip_content`, `a11y.skip_nav`
- `a11y.statement_title`, `a11y.statement_link`
- `a11y.report_issue`
- `a11y.badge.success_sr`, `a11y.badge.warning_sr`, `a11y.badge.danger_sr`, `a11y.badge.info_sr`
- `a11y.loading_sr`
- `a11y.dialog_close`
- `a11y.menu_more`

## Garde-fous
- Catchall reduced-motion : règles ciblées Sprint 32-48 restent prioritaires (specificity + ordre source)
- Touch-target : `@media (pointer: coarse)` mobile-only, préserve Stripe-clean desktop
- Icon aria-hidden : API préservée (props additionnelles opt-in), compat 100%
- Badge soft text change : ratio 3.40:1 → 7.18:1 (visuellement teinte plus foncée, reste reconnaissable)
- ACCESSIBILITY.md publique = phrasing prudent ("AAA partiel atteint", limitations listées), PAS "100% AAA conforme"
- Parité ×4 i18n verrouillée par test LOT C
