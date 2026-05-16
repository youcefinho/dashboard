# Cross-browser audit — Sprint 50 M1.1

Date : 2026-05-16
Scope : audit STATIQUE du code (pas de run navigateur — VMware, pas de bun).
Cible : Chrome, Edge, Firefox, Safari (desktop), Mobile Safari (iOS 15+), Mobile Chrome.

## Résumé

| Pattern | Statut | Action |
|---|---|---|
| `backdrop-filter` sans préfixe `-webkit-` | ❌ → ✅ FIXÉ | 5 prefixes ajoutés |
| `:has()` | ✅ Absent | Aucune occurrence dans index.css |
| `color-mix()` | ✅ OK | 6 usages — supporté Chrome 111+/Safari 16.2+/FF 113+ (largement OK 2026) |
| `aspect-ratio` | ✅ OK | 3 usages — Safari 15+/Chrome 88+ (baseline 2026) |
| `gap` flexbox | ✅ OK | Safari 14.1+ — baseline 2026 |
| `inset` shorthand | ✅ OK | Safari 14.1+ — baseline 2026 |
| `Intl.supportedValuesOf` | ✅ Guardé | Sprint 48 — `typeof === 'function'` + fallback liste QC/CA |
| `structuredClone` / `Object.groupBy` / `Array.at()` | ✅ Absent | Aucune occurrence |
| `navigator.clipboard.writeText` | ⚠️ Noté | 5 call sites sans guard — acceptable HTTPS-only (voir ci-dessous) |
| `navigator.share` | ✅ Guardé | ShareButton.tsx feature-detect propre |

## Détail des fixes appliqués

`backdrop-filter` nécessite le préfixe `-webkit-` sur Safari (desktop ≤ 18 et
Mobile Safari) qui ne supporte toujours pas la propriété non-préfixée de manière
fiable. Sans le préfixe, l'effet de flou (overlays, sticky bars, hints) ne
s'applique pas du tout sur Safari → fond opaque/transparent incohérent.

Lignes corrigées dans `src/index.css` (ajout `-webkit-backdrop-filter`) :

1. `.sidebar-overlay` (~L1727) — `blur(2px)` overlay sidebar mobile
2. `.composer-slash-hint` (~L4064) — `blur(2px)` hint slash composer Inbox
3. État empty d'un panneau (~L4874) — `blur(1px)` overlay surface
4. Modal overlay (~L8649) — `blur(4px)` backdrop modal
5. Blog sticky bar (~L8782) — `blur(6px)` barre sticky marketing

Les autres occurrences (L554/555, L917/918, L7949/7950) avaient déjà le préfixe.

## Points notés (acceptables, aucun fix)

### navigator.clipboard sans guard
Call sites sans feature-detect explicite :
- `src/components/settings/SecuritySettings.tsx:110`
- `src/components/panels/AiNextActionCard.tsx:41`
- `src/pages/Integrations.tsx:129`
- `src/pages/FormBuilder.tsx:299`
- `src/pages/TriggerLinks.tsx:59`

`navigator.clipboard` est universellement supporté sur tous les navigateurs
cibles 2026 **en contexte sécurisé (HTTPS)**. L'app est servie en HTTPS
(Cloudflare Workers) → pas de risque réel. Les chemins critiques
(ShareButton, MessageBubble, BlogArticle) ont déjà un feature-detect. Pas de
fix imposé pour ne pas alourdir ; à surveiller si un call site devient
accessible en HTTP local non sécurisé.

### color-mix()
6 usages. Baseline largement atteinte en 2026 (Safari 16.2+ / Chrome 111+ /
Firefox 113+). Tous les navigateurs cibles à jour le supportent. Pas de
fallback nécessaire pour la cible PME 2026.

## Conclusion

Aucun bloqueur cross-browser. Seul problème réel (backdrop-filter Safari)
corrigé : 5 prefixes `-webkit-` ajoutés (append-in-place, API CSS préservée).
Tout le reste est dans la baseline navigateur 2026.
