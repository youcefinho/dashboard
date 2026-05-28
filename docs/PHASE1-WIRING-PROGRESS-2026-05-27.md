# PHASE 1 — Câblage engines→handlers : journal (2026-05-27)

> Mission V2. Session VM (git ✅, bun/node ❌). Chaque batch = câblage **100% additif sans changement de comportement** (byte-identique / sur-ensemble strict). Les câblages qui CHANGENT le runtime (policy mot de passe, formats de tokens, nouveaux types) sont **DIFFÉRÉS** = décision Rochdi + validation hôte, jamais à l'aveugle.

## Principe de sûreté (validation aveugle)
Je ne câble un helper engine QUE si sa sortie est **identique** à la logique inline pour toute entrée que les tests existants exercent. Vérifié par lecture des deux côtés + du test existant AVANT chaque edit. Tout le reste est listé en « différé ».

---

## Batch 1.1 — Auth/Security ✅ (partiel, sûr)

### Câblé (sans changement de comportement)
| Handler | Engine | Helper(s) câblé(s) | Nature | Régression |
|---|---|---|---|---|
| `security-admin.ts` | `security-admin-engine` | `extractUserIdFromPath`, `formatAuditLogEntry` | sur-ensemble strict / shape identique | aucune (test handler utilise `details:'{}'` → sortie identique) |
| `compliance.ts` | `compliance-engine` | `buildDataExport` | byte-identique (purpose Loi 25 passé explicitement) | aucune |

- `security-admin.ts` : suppression des locaux `parseDetails` + `extractUserIdFromPath` (dupliquaient l'engine). Map inline → `formatAuditLogEntry`.
- `compliance.ts` : `handleExportPii` assemble via `buildDataExport({…, purpose:'…(Québec)'})`. Purpose explicite pour éviter le `" / RGPD Art 15"` ajouté par défaut.
- Tests wire-up ajoutés (source-anchor `readFileSync`) : `security-admin.test.ts` (+2 it), `compliance.test.ts` (+2 it).

### DIFFÉRÉ (changement de comportement → décision Rochdi + validation hôte)
| Handler | Engine | Pourquoi différé |
|---|---|---|
| `auth.ts` | `auth-engine` | `parseAuthHeader` : signature `{token,error,code}` ≠ extract string inline (adaptateur requis). `validatePassword` : porte la longueur min de 6/8 → **12** (changement de POLICY, casse logins/tests legacy). `normalizeEmail`/`validateEmailLogin` : peut changer la résolution de lookup. |
| `auth.ts`/`crypto.ts` | `auth-engine` | `hashPassword`/`verifyPassword` : **crypto.ts est la source de prod**, auth-engine ne fait que ré-implémenter pour la pureté. Câbler = redondant/risqué. |
| `auth.ts` | `security-engine` | `generateBackupCodes` (hex 8 → format `XXXX-XXXX`) et `generatePwdResetToken` (UUID → hex 48) = **changement de format = casse données/liens existants**. Migration atomique requise. |
| `dashboard.ts`(?) | `security-engine` | Endpoints TOTP/MFA non localisés (probable P0-8 futur) — pas de point de câblage actuel. |
| `compliance.ts` | `compliance-engine` | `validateConsentInput` (allowlist 5→9 types) : additif mais peut changer des rejets testés. `validateGdprRequest`/`isWithinGdprWindow`/`redactPii` : pas de call-site existant. À introduire avec tests dédiés côté hôte. |

### Diff fichiers Batch 1.1
- `src/worker/security-admin.ts` (câblage + retrait 2 locaux)
- `src/worker/compliance.ts` (câblage buildDataExport)
- `src/worker/__tests__/security-admin.test.ts` (+ import fs/path, +1 describe wire-up)
- `src/worker/__tests__/compliance.test.ts` (+ import fs/path, +1 describe wire-up)

## Batch SAFE billing ✅ (S3 + S4, byte-identique vérifié)
Après mapping des 12 batches (4 agents Explore → `PHASE1-WIRING-MASTER-PLAN`), j'ai vérifié manuellement les 7 « SAFE » proposés : **5/7 étaient en réalité des behavior-changes** (S1 helper inexistant ; S2 clamp ≥0 ; S5 edge-cases dates ; S6 validation status/duration ; S7 seuils différents). Seuls **S3+S4** sont byte-identiques :
| Handler | Helper | Preuve d'équivalence |
|---|---|---|
| `billing.ts` | `formatInvoiceNumber(count+1, year, 4)` | `INV-${year}-${pad4}` identique (gardes engine no-op pour entier ≥1) |
| `billing.ts` | `computeTaxBreakdown(subtotal,'QC')` | `round2` byte-identique (`Math.round(x*100)/100`) + taux QC 0.05/0.09975 identiques → tps/tvq inchangés |

Diff : `src/worker/billing.ts` (import + 2 call-sites) + `src/worker/__tests__/billing-wireup.test.ts` (NEW, 5 it).

**Leçon clé** : ne jamais faire confiance au classement SAFE d'un agent sans relecture comparée — taux d'erreur observé 5/7.

## Batch DEFERRED câblés sur demande (⚠️ behavior-changes assumés)
Rochdi a demandé de câbler aussi les 5 « DEFERRED ». Après relecture, **3 sont des behavior-changes assumables → CÂBLÉS** ; **2 sont des bugs latents → BLOQUÉS** (un changement de comportement assumé ≠ casser une feature / fausser de l'argent).

### ✅ Câblés (behavior-change documenté, validation hôte)
| Handler | Helper | Delta de comportement |
|---|---|---|
| `ecommerce-inventory.ts` | `computeAvailable` (l.144 `shapeInventory`) | `available` désormais **clampé ≥0 + arrondi** (réservé>quantité : négatif→0). ⚠️ ligne SQL ~410 `(quantity-reserved)` inchangée (non remplaçable). |
| `conversion-engine.ts` | `confidenceFromSampleSize` (délégué dans `confidenceFromSample`) | seuils **plus fins** : `>500 high / >50 medium / sinon low` (legacy `≥50 high / ≥10 medium`). Affecte le champ `confidence` partout (l.567, 619). |
| `memberships.ts` | `isLessonAvailable` (délégué dans `dripUnlocked`) | `enrolledAt=""`→disponible (legacy bloqué) ; dates avec offset tz parsées (legacy NaN→débloqué). |

→ Tests probablement à ajuster côté hôte : inventory negatif→0, conversion confidence thresholds, memberships drip edge-cases.

### 🛑 BLOQUÉS (bugs latents, PAS des behavior-changes)
| Handler | Helper | Pourquoi bloqué |
|---|---|---|
| `ecommerce-coupons.ts` | `computeDiscount` | `pickDiscountValue` met `percent` par DÉFAUT + lit `value` (pas `discount_amount`) en fallback fixe. Un coupon legacy **fixe sans `discount_type`** → calculé percent valeur 0 → **remise=0** (bug monétaire silencieux). Délégation impossible sans pré-normaliser (ce qui rend l'appel engine inutile). |
| `telephony.ts` | `parseStatusCallback` | Statuts non-whitelistés / intermédiaires → `null` → `UPDATE status='completed'` au lieu du statut réel. Fausse le suivi d'appels. |

**Pour forcer S1/S6 quand même** : il faudrait soit corriger l'engine (aligner `pickDiscountValue` sur le legacy ; élargir la whitelist statuts), soit pré-normaliser l'input — décision côté hôte avec tests, pas à l'aveugle VM.

---

## 🔎 Constat de fond (important)
Les engines ont été créés **en parallèle** de la logique existante (mode 100% additif). « Câbler » ne veut donc PAS dire brancher un trou vide : ça veut dire **remplacer une logique de prod qui marche par une variante subtilement différente** (souvent plus stricte/meilleure). Exemples confirmés :
- `audit()` fait DÉJÀ le scrub PII via `audit-redact.ts` (par **clés** sensibles, Sprint 23). `audit-engine.sanitizeMetadata` redige par **valeur** (regex contenu). Les brancher = changer ce qui est rédigé + le flag `redacted` → casse probable des tests Sprint 23. **Le « quick win » du handoff n'en est pas un.**
- `hashPassword`/`verifyPassword` : `crypto.ts` est la source de prod ; auth-engine duplique.
- `validatePassword` engine = min 12 ; auth.ts = 6/8 (policy).

**Conséquence** : la majorité des câblages Phase 1 = **changement de comportement** → exigent de (a) lancer les tests pour voir ce qui casse, (b) mettre à jour les tests, (c) décision policy Rochdi. **Impossible à faire sûrement à l'aveugle dans la VM.** Seules les extractions **byte-identiques** (comme Batch 1.1) sont sûres ici.

## Validation hôte (à exécuter par lot)
```bash
cd C:/Users/rochdi/.gemini/antigravity-ide/scratch/intralys-dashboard
bun run build 2>&1 | grep "error TS" | head -5             # attendu : vide
bun run test 2>&1 | grep -E "Test Files|Tests  " | tail -3  # attendu : 5273 +réactivé(0.4) +4 wire-up
node scripts/i18n-parity-audit.cjs 2>&1 | tail -5           # attendu : 0 missing × 4 (aucune clé i18n touchée)
```

## Commits (rule #9 = 1 commit/batch)
⚠️ NON committé depuis la VM (validation aveugle). Reco : valider côté hôte PUIS committer par batch (`feat(wire): batch 1.1 security-admin + compliance engines`). Si rouge → fix-forward avant batch suivant.
