# V2 Backlog — Modules hors scope construction

Ces modules contiennent du code **valide** mais **hors scope** de la phase actuelle (construction du clone GHL).

Ils seront réactivés quand le clone sera mature et qu'on sera prêt pour les intégrations réelles.

## Modules

### `migrate.ts` (553 lignes)
Migration depuis GoHighLevel réel via PIT token. Permet d'importer :
- Contacts GHL → leads
- Conversations GHL → conversations + messages
- Pipelines GHL → pipelines + stages
- Calendars GHL → appointments

**Quand réactiver :** V2 (3-6 mois), quand le premier courtier voudra migrer de GHL vers Intralys.

### `gbp.ts` (26 lignes)
Google Business Profile — fetch des avis Google. Code actuel utilise une API key simple, mais la vraie GBP API nécessite OAuth2 user-scoped.

**Quand réactiver :** V2, après avoir configuré un projet Google Cloud avec OAuth2 consent screen.

### `gcal.ts` (77 lignes)
Google Calendar — OAuth2 + sync bidirectionnelle. Code de base fonctionnel (token refresh, events list, sync) mais incomplet pour production (manque UI callback, encryption tokens, conflict resolution).

**Quand réactiver :** V2, quand les courtiers demanderont la sync calendrier.

---

_Déplacé le 2026-05-11 lors du Sprint Consolidation._
