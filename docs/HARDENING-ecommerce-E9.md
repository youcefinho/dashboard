# Hardening e-commerce — Audit Sprint E9 M3.4

> **Audit DOC uniquement.** Aucune ligne de code régulé (paiement E4,
> remboursement/litige E6, billing, providers) modifiée. Méthode :
> recherche par motif (`grep`/ripgrep insensible à la casse) sur les
> migrations + le code E1-E8, puis classification de chaque occurrence.

---

## 1. Audit PCI — recherche `card` / `PAN` / `CVV` / `pan` / `cvv`

### 1.1 Migrations SQL (`migration*.sql`)

Motif : `\b(card|PAN|CVV|pan|cvv|card_number|cardnumber|ccnum|security_code)\b`

| Fichier:ligne | Occurrence | Classification |
|---|---|---|
| `migration-sprintE4-m1.sql:7` | `-- PCI : ZÉRO colonne carte (PAN/CVV/expiry/track).` | **Commentaire d'assertion** — pas de schéma carte. PCI-safe. |
| `migration-sprintE4-m1.sql:59` | `-- … JAMAIS de PAN ni de …` | **Commentaire d'assertion**. PCI-safe. |
| `migration-sprintE6-m1.sql:10` | `-- PCI : ZÉRO colonne carte (PAN/CVV/expiry/track).` | **Commentaire d'assertion**. PCI-safe. |
| `migration-sprintE6-m2.sql:12` | `-- PCI : ZÉRO colonne carte … Seules des RÉFÉRENCES …` | **Commentaire d'assertion**. PCI-safe. |

→ **Aucune colonne** `card_number`, `pan`, `cvv`, `expiry`, `track` créée
dans AUCUNE migration. Les seules occurrences sont des **commentaires
affirmant l'absence** de données carte.

### 1.2 Code worker / lib (`src/**`)

Motif : `card_brand|last4|last_4|\bcvv\b|card_number|\bPAN\b|\bcard\b|tokeniz`

| Fichier:ligne | Occurrence | Classification |
|---|---|---|
| `src/lib/types.ts:1122` | `// … PCI : aucun type ne porte de donnée carte (PAN/CVV/expiry) …` | **Commentaire d'assertion**. PCI-safe. |
| `src/worker/ecommerce-payments.ts:10` | `// PCI minimal : AUCUNE donnée carte (PAN/CVV/expiry) ne transite ici.` | **Commentaire d'assertion**. PCI-safe. |
| `src/worker/payments/dz-gateway-provider.ts:16` | `// … Aucune clé secrète, aucun PAN/CVV : ce provider …` | **Commentaire d'assertion**. PCI-safe. |
| `src/worker/payments/stripe-provider.ts:9` | `// Aucune donnée carte (PAN/CVV/expiry) ne transite/stocke ici.` | **Commentaire d'assertion**. PCI-safe. |
| `src/worker/payments/stripe-provider.ts:47` | `// connect_account_ref = réf compte externe OPAQUE (jamais de PAN/secret).` | **Commentaire d'assertion** + référence opaque. PCI-safe. |
| `src/components/ui/BottomSheet.tsx:136,145` | `pan-y` (CSS `touch-action`) | **Faux positif** — propriété CSS de défilement, sans rapport avec les données carte. |

### 1.3 Recherche `card_brand` / `last4` / `last_4`

→ **Zéro occurrence** dans tout `src/`. Aucune colonne ni champ
`card_brand`/`last4` n'existe : les paiements sont **entièrement
tokenisés côté fournisseur** (Stripe / passerelle DZ), Intralys ne
manipule que des **références opaques** (`connect_account_ref`, IDs de
transaction fournisseur).

---

## 2. Conclusion d'audit

- **Périmètre PCI réduit (SAQ-A).** Aucune donnée carte (PAN, CVV,
  expiry, track) n'est saisie, transitée ou stockée par Intralys. Toutes
  les occurrences du motif sont soit des **commentaires d'assertion**
  documentant cette absence, soit un **faux positif CSS** (`pan-y`).
- **Aucun champ tokenisé sensible** : il n'existe même pas de
  `card_brand`/`last4` — le périmètre est encore plus restreint que le
  cas « last4 PCI-safe ». Si de tels champs étaient ajoutés un jour, ils
  devraient provenir UNIQUEMENT du token fournisseur (non sensibles).
- **Aucune modification apportée** au code régulé : E9 M3.4 est un
  livrable de documentation/audit. Le paiement (E4), le
  remboursement/litige (E6), le billing et les providers restent
  **intouchés**. `payments_live_enabled` inchangé.

---

## 3. Recommandations de hardening (non bloquantes — à arbitrer Rochdi)

1. **Garde-fou CI** : règle de lint/CI interdisant l'ajout d'une colonne
   `pan|cvv|card_number|expiry|track|security_code` dans toute migration.
2. **Secrets** : confirmer que les clés fournisseur sont en secrets
   Workers (binding), jamais en base ni dans le repo.
3. **Journalisation** : s'assurer qu'aucun log ne sérialise un payload
   fournisseur brut (risque de fuite indirecte).
4. **Revue légale E4/E6** avant `payments_live_enabled = 1`
   (voir `PCI-RGPD-GOLIVE-checklist.md`).
5. **Profilage churn (Loi 25 / RGPD art. 22)** : les raisons explicables
   renvoyées par `/api/ecommerce/reco/churn/:id` doivent rester
   compréhensibles et documentées au registre des traitements.
