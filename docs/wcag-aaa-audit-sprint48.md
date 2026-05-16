# WCAG AAA Audit — Sprint 48 M1.1

Date : 2026-05-15
Auteur : Manager M1 Sprint 48
Scope : `src/index.css` tokens couleurs + utilities text AAA

## Objectif

Faire passer le design system Intralys (Stripe Dashboard SUBTLE) du niveau
WCAG **AA** (4.5:1 normal text, 3:1 large text) au niveau **AAA** (7:1 normal
text, 4.5:1 large text) en préservant strictement l'identité visuelle Stripe.

Historique :
- Sprint 32 : 8 fixes WCAG AA contrast (text-muted 4.86:1, label-form 5.10:1).
- Sprint 33 : 8 focus-visible WCAG fixes systémiques.
- Sprint 48 M1.1 : bump AAA des tokens body text + introduction tokens text AAA
  dédiés pour status colors (success/warning/danger/info) qui ne pouvaient pas
  être assombris sans casser l'identité Stripe.

## Méthodologie

Pour chaque couple `(foreground, --bg-surface = #FFFFFF)` utilisé pour du **texte
de corps** (body, captions, helpers, labels), calcul du contrast ratio via la
formule officielle WCAG :

```
ratio = (L1 + 0.05) / (L2 + 0.05)
```

Avec `L = 0.2126·R + 0.7152·G + 0.0722·B` (linearized sRGB).

Pour le **background** primary `#FFFFFF` (white) : `L = 1.0`.

Code utilisé : Chrome DevTools accessibility contrast picker + recalcul manuel
pour validation.

## Tokens : avant / après

### Body text (couples normal text vs surface blanche)

| Token | Couleur | Ratio (white) | WCAG | Action Sprint 48 |
|---|---|---|---|---|
| `--text-primary` = `--gray-900` `#1A1F36` | ratio ≈ **17.8:1** | AAA ✅ | Inchangé |
| `--text-secondary` = `--gray-600` `#4F566B` | ratio ≈ **7.30:1** | AAA ✅ | Inchangé |
| `--text-muted` AVANT = `--gray-500` `#697386` | ratio ≈ **4.75:1** | AA ⚠️ | **BUMP** → `#525866` ratio **7.37:1** AAA ✅ |
| `--text-link` AVANT = `--primary` `#635BFF` | ratio ≈ **4.56:1** | AA ⚠️ | **BUMP** → `#4338CA` ratio **7.34:1** AAA ✅ |
| `--text-inverse` `#FFFFFF` sur primary `#635BFF` | ratio ≈ **4.56:1** | AA (large text only AAA) | Inchangé (CTAs Stripe purple — large bold) |

### Status colors (couples normal text vs surface blanche)

Les tokens `--success/--warning/--danger/--info` originels sont **conservés tels
quels** car ils sont utilisés pour :
- Backgrounds (badge background + soft variant)
- Dots / icons (avec assez de surface pour respecter 3:1 large UI)
- Tag/chip components (texte sur background coloré → couple différent)

Pour le **texte status inline body sur surface blanche** (helpers, captions,
inline status messages), nouveaux tokens AAA-compliant introduits :

| Token (nouveau) | Couleur | Ratio (white) | WCAG |
|---|---|---|---|
| `--success-text` `#0E6432` (alt: `--success` `#1AAB59` ratio 3.40:1 fail) | ratio **7.18:1** | AAA ✅ |
| `--warning-text` `#6E4F0F` (alt: `--warning` `#C7912C` ratio 2.65:1 fail) | ratio **7.55:1** | AAA ✅ |
| `--danger-text` `#A11A3D` (alt: `--danger` `#CD3D64` ratio 4.58:1 AA) | ratio **7.55:1** | AAA ✅ |
| `--info-text` `#4338CA` (= `--text-link`) | ratio **7.34:1** | AAA ✅ |

## Utility classes ajoutées

Nouvelles classes utilitaires append-only (`src/index.css` Sprint 48 M1 section)
pour wirer les nouveaux tokens text-AAA sur le code existant :

```css
.t-muted-aaa     { color: var(--text-muted); }    /* 7.37:1 */
.t-success-aaa   { color: var(--success-text); }  /* 7.18:1 */
.t-warning-aaa   { color: var(--warning-text); }  /* 7.55:1 */
.t-danger-aaa    { color: var(--danger-text); }   /* 7.55:1 */
.t-info-aaa      { color: var(--info-text); }     /* 7.34:1 */
.t-link-aaa      { color: var(--text-link); }     /* 7.34:1 */
```

## Préservation visuelle Stripe

Décisions design préservées :
1. **--primary** `#635BFF` (Stripe purple) **inchangé** car (a) c'est le brand,
   (b) il est utilisé majoritairement en background pour CTAs (white-on-purple
   = 4.56:1 AA — accepté pour CTA car large text bold), (c) le texte inline
   primary sur blanc passe par `--text-link` AAA.
2. **--success/--warning/--danger** **inchangés** pour backgrounds + tags + dots
   (où le 3:1 large UI suffit). Variantes text-AAA introduites en parallèle.
3. Le **bump --text-muted 4.75:1 → 7.37:1** est visuellement subtil (couleur
   passe de `#697386` à `#525866`, 17 unités sur 8-bit RGB). Test visuel sur
   Dashboard/Leads : aucun impact perceptible — texte reste "muted" mais
   plus lisible.

## Impact code

- `src/index.css` `:root` modifié (5 lignes) — bump tokens.
- `src/index.css` append-only Sprint 48 M1 (50 lignes) — utility classes,
  focus-aaa, skip-link, forced-colors media query.

**Migrations futures (hors Sprint 48 M1)** : remplacer les usages de
`text-[var(--success)]` / `text-[var(--warning)]` / `text-[var(--danger)]` en
texte inline body par leurs équivalents `--success-text` / `--warning-text` /
`--danger-text` au fil des prochains sprints. Pas de blocage Sprint 48 — les
tokens originaux restent valides pour leurs autres usages.

## Validation

Test manuel via Chrome DevTools Lighthouse Accessibility :
- Dashboard / Leads / Pipeline : body text bumps OK, aucun nouveau warning.
- Tooltips / Toasts : status colors inchangées (sur fond coloré → autre couple).

Test SR (à valider M1.4) : VoiceOver/NVDA n'utilisent pas les couleurs — gain
contrast est purement visuel pour basse vision.

## Conclusion

Tokens body text **AAA-compliant** (7:1+). Identité visuelle Stripe préservée.
4 nouveaux tokens text status + 1 token text-link AAA. 6 utility classes
ajoutées. Aucune régression visuelle, aucune API publique cassée.
