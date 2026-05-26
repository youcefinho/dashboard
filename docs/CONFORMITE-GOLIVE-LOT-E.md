# CONFORMITÉ GO-LIVE — Dossier de synthèse (LOT E · GIGA-PLAN-V2)

> **Document de SYNTHÈSE et de RENVOI uniquement.** Il ne RÉ-ANALYSE rien et
> ne DUPLIQUE aucun contenu régulé : il pointe vers la source de vérité
> (`docs/PCI-RGPD-GOLIVE-checklist.md`, lecture seule) par `chemin:section` et
> apporte les **preuves code** vérifiées (fichier:ligne) attestant que la
> conformité est appliquée dans le code, pas seulement documentée.
>
> ⚠️ **VM VMware : aucune commande build/test/migration/git jouée ici.** Aucun
> gate, aucune revue, aucune signature n'a été exécutée. Tout ce qui suit est
> **écrit, NON exécuté / NON signé** — la décision et les actes humains
> (revue PCI, revue légale, signature) restent à la charge de Rochdi sur la
> machine hôte. Ce document est doc-only : il ne lève rien.
>
> Source de vérité régulée NON dupliquée ici : `docs/PCI-RGPD-GOLIVE-checklist.md`
> (Sprint E9 M3.4, audit + checklist). Toute valeur normative provient de ce
> fichier ; ce dossier n'ajoute QUE des renvois et des preuves code.

---

## ✅ SPRINT R — RÉSOLU 2026-05-17 (rappel non régulé)

Les 6 pages cœur CRM (`Leads`, `Dashboard`, `LeadDetail`, `Tasks`,
`Pipeline`, `Clients`) ont été restaurées par Antigravity (commit `5764096`
→ réparation `7846e72`), 0 `t()` orphelin vérifié, FR hardcodé restauré.
R ne bloque plus le go-live (cf `docs/GOLIVE-S10.md` en-tête + `LAUNCH-CHECKLIST.md`).
**Cela ne lève AUCUNE des conditions régulées de ce dossier** (R = utilisabilité
app ; ce dossier = conformité paiement/données — axes distincts).

---

## (a) Périmètre PCI — SAQ-A

- **Source de vérité (NON recopiée)** :
  `docs/PCI-RGPD-GOLIVE-checklist.md:10-35` — « §1 Périmètre PCI-DSS ».
  Constat d'audit (zéro donnée carte stockée/transitée, tokenisation 100 %
  côté fournisseur, périmètre réduit au **SAQ-A**) : voir cette section,
  **ne pas dupliquer ici**.
- **Statut** : SAQ-A *applicable sous réserve* — la confirmation avec
  l'acquéreur / le fournisseur est une **case NON cochée**
  (`PCI-RGPD-GOLIVE-checklist.md:29-34`, items « Confirmer SAQ-A applicable »,
  « clés API en secrets Workers », « `payments_live_enabled = 0` tant que
  revue non signée »).
- **Preuve code (binding régulé non configuré)** : les secrets Stripe
  marchands sont catégorisés **« Régulé NON configuré (E4/E6) »** et NE
  doivent PAS être configurés tant que `payments_live_enabled=0` —
  `docs/BINDINGS-SECRETS-S10.md` § 4 (`STRIPE_SECRET_KEY` `types.ts:38`,
  `STRIPE_WEBHOOK_SECRET` `types.ts:39`).

## (b) RGPD / Loi 25 / CASL — données client

- **Source de vérité (NON recopiée)** :
  `docs/PCI-RGPD-GOLIVE-checklist.md:38-58` — « §2 RGPD / Loi 25 (Québec) »
  (droit d'accès/portabilité, droit à l'oubli/anonymisation, minimisation,
  consentement relances, registre des traitements, conservation). Renvoi
  uniquement, **pas de copie**.
- **Preuves code — la conformité est appliquée, pas seulement documentée :**
  - **Droit à l'oubli (Loi 25)** : `src/worker/compliance.ts:156-176`
    (`handleForgetLead`) — anonymise `leads` (`name/email/phone/message`
    → `'[SUPPRIMÉ]'`), purge `messages` et `consent_log`, journalise via
    `audit(... 'lead.forget' ... reason: 'Droit à l'oubli Loi 25')`
    (`compliance.ts:171-173`). Admin-only (`compliance.ts:159`).
  - **Droit d'accès / portabilité** : `src/worker/compliance.ts:178-210`
    (`handleExportPii`) — export lead + messages + consents + activities,
    `purpose` explicite « Export de données personnelles — Loi 25 …(Québec) »
    (`compliance.ts:207`), tracé `audit(... 'lead.export_pii' ...)`.
  - **Journal de consentement** : `src/worker/compliance.ts:113-141`
    (`handleLogConsent`) — table `consent_log` (types autorisés :
    `marketing_email/marketing_sms/data_processing/cookies/third_party_sharing`,
    `compliance.ts:124`), IP + User-Agent horodatés, tracé `audit`.
  - **CASL (anti-pourriel)** : `src/worker/compliance.ts:28-35`
    (`generateCaslFooter`, mention LCAP/CASL + lien désabonnement),
    `:46-60` (`isUnsubscribed`), `:64-96` (`handlePublicUnsubscribe`,
    page de confirmation FR conforme).
  - **Consentement obligatoire — flux beta (Loi 25 / CASL)** :
    `src/worker/beta.ts:12-13` (en-tête contractuel : « consentement
    explicite (consent=1) est OBLIGATOIRE côté signup ») et
    `src/worker/beta.ts:139-142` (rejet `400` si `b.consent !== true`,
    message « Le consentement est requis pour rejoindre la liste. »).
    Colonne `beta_signups.consent INTEGER DEFAULT 0` (`beta.ts:56`),
    forcée à `1` à l'insertion/upsert (`beta.ts:145,148`).
  - **Consentement — capture lead (colonne `consent_status`)** : la colonne
    régulée `leads.consent_status` est ajoutée par
    `migration-sprint51-m2.sql` (cf vérif Gate 4,
    `docs/GOLIVE-S10.md:104-106`) et fait partie des 7 colonnes dont la
    présence est contrôlée post-migration (conflit gclid C1). Câblage :
    `src/worker/forms.ts`, `src/worker/leads.ts`, `src/worker/lead-sources.ts`
    (capture multi-source, consentement Loi 25). *Référence d'existence et de
    contrôle, aucune analyse régulée ajoutée ici.*
- **Statut** : mécanismes **présents dans le code** ; les actes RGPD/Loi 25
  documentaires restent des **cases NON cochées**
  (`PCI-RGPD-GOLIVE-checklist.md:56-58` : mentions légales boutique, registre
  des traitements, politique de conservation) — actes humains non signés.

## (c) Cohérence multi-région

- **Source de vérité (NON recopiée)** :
  `docs/PCI-RGPD-GOLIVE-checklist.md:62-75` — « §3 Cohérence multi-région »
  (règle d'or « jamais de somme cross-devise », ventilation par devise,
  `resolveRegionContext`, taxes par région QC TPS/TVQ / FR TVA). Renvoi
  uniquement.
- **Statut** : règles documentées ; vérifications go-live = **cases NON
  cochées** (`PCI-RGPD-GOLIVE-checklist.md:72-73` : config région boutique
  vérifiée, mentions fiscales correctes par région).

## (d) Conditions de levée `payments_live_enabled`

- **Source de vérité (NON recopiée — RENVOI STRICT)** :
  `docs/PCI-RGPD-GOLIVE-checklist.md:119-149` — section
  **« §5 Conditions de levée `payments_live_enabled` »** (vérifiée présente :
  intitulée exactement ainsi, lignes 119-149 ; les 5 conditions cumulatives
  sont aux lignes 127-143). **Le contenu détaillé n'est PAS recopié ici** —
  consulter cette section. Résumé strictement non normatif des intitulés
  (pour repérage, faisant foi = la source) :
  1. Revue PCI (SAQ-A) signée ;
  2. Revue légale / RGPD / Loi 25 E4 + E6 signée ;
  3. `STRIPE_*` configurés via `wrangler secret put` (cf
     `docs/BINDINGS-SECRETS-S10.md` § 4) ;
  4. Tests sandbox verts (`ecommerce-payments-sandbox`, `refunds-sandbox`) ;
  5. Décision explicite de Rochdi, tracée et datée.
- **Statut figé** : **les 5 conditions cumulatives sont NON remplies.**
  Aucune revue PCI signée, aucune revue légale E4/E6 signée, `STRIPE_*` non
  configurés (cf `BINDINGS-SECRETS-S10.md` § 4), tests sandbox non exécutés
  (VM), aucune décision Rochdi tracée. Un seul item manquant suffit à
  maintenir le flag à `0` (`PCI-RGPD-GOLIVE-checklist.md:145-149`).
  → **`payments_live_enabled` reste à `0`.**

## (e) Attestation d'état honnête — documenté vs acte humain non signé

| Élément | Documenté / appliqué dans le code | Acte humain restant (NON signé) |
|---|---|---|
| Périmètre PCI SAQ-A | Audité (`PCI-RGPD-GOLIVE-checklist.md:10-35`), zéro carte côté Intralys ; `STRIPE_*` non configurés | Confirmation SAQ-A avec acquéreur/fournisseur + **revue PCI signée** |
| RGPD / Loi 25 / CASL | Code appliqué : oubli/export/consent (`compliance.ts:156-210,113-141`), CASL (`compliance.ts:28-96`), consent beta obligatoire (`beta.ts:12-13,139-142`), `leads.consent_status` (`migration-sprint51-m2.sql`) | **Revue légale / RGPD / Loi 25 E4+E6 signée** ; mentions légales boutique, registre traitements, politique de conservation (`:56-58`) |
| Multi-région | Règles documentées (`:62-75`), TPS/TVQ/TVA par région | Vérif config région + mentions fiscales par région (`:72-73`) |
| `payments_live_enabled` | Flag = `0` ; conditions de levée documentées (`:119-149`) | **5 conditions cumulatives** — toutes NON remplies, dont décision Rochdi tracée |
| Secrets régulés Stripe | Inventoriés « Régulé NON configuré » (`BINDINGS-SECRETS-S10.md` § 4) | `wrangler secret put STRIPE_*` — **NE PAS faire** tant que levée non décidée |
| Tests sandbox paiement/refund | — | Suites `ecommerce-payments-sandbox` / `refunds-sandbox` exécutées vertes (hors VM) |

> Honnêteté absolue : ce dossier prouve que la conformité est **codée et
> documentée**, PAS qu'elle est **signée**. Aucune ligne ne dit « prêt prod ».

## (f) Verdict

> **🔴 GO-LIVE RÉGULÉ (paiement / remboursement / litige E4-E6) = BLOQUÉ.**
>
> - **E4/E6 NON cleared** : zones paiement/remboursement/litige intouchées,
>   non validées juridiquement.
> - **`payments_live_enabled = 0`** : non levé. Les 5 conditions cumulatives
>   (`PCI-RGPD-GOLIVE-checklist.md:119-149`) sont **toutes NON remplies**.
> - **Revue PCI (SAQ-A) + revue légale/RGPD/Loi 25 E4+E6 : NON signées.**
> - Le go-live régulé reste **bloqué tant que la revue humaine n'est pas
>   signée** et la décision de Rochdi tracée. Aucun gate, aucune ligne de ce
>   dossier ne lève cette condition.
>
> Le CRM non régulé peut suivre son parcours normal (5 gates Rochdi +
> prérequis infra, cf `docs/GOLIVE-S10.md`) — **indépendamment** ; il
> n'active jamais le paiement marchand.

---

## Renvois (sources, non dupliquées)

- `docs/PCI-RGPD-GOLIVE-checklist.md` — **source de vérité régulée** :
  §1 PCI (`:10-35`), §2 RGPD/Loi 25/CASL (`:38-58`), §3 multi-région
  (`:62-75`), §4 migrations/déploiement (`:77-115`), §5 conditions de levée
  `payments_live_enabled` (`:119-149`). *Lecture seule — non modifié.*
- `docs/BINDINGS-SECRETS-S10.md` — § 4 « Régulé NON configuré (E4/E6) »
  (`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`).
- `docs/GOLIVE-S10.md` — 5 gates Rochdi (§1, §6.2), Gate 4 vérif colonnes
  `leads` post-`sprint51-m2` (`:104-106`, dont `consent_status`).
- `src/worker/compliance.ts` — droit à l'oubli/export PII/consent/CASL
  (preuves code, lecture).
- `src/worker/beta.ts` — consentement explicite obligatoire signup beta
  (preuve code, lecture).

> Statut : dossier de synthèse **écrit, NON exécuté / NON signé** (VM VMware).
> Zéro contenu régulé dupliqué — uniquement renvois `chemin:section` +
> preuves code (fichier:ligne) vérifiées sur disque.
