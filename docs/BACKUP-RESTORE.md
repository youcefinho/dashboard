# Sauvegarde et Restauration (Cloudflare D1)

La base de données principale d'Intralys CRM est hébergée sur **Cloudflare D1**. Il est crucial de maintenir des sauvegardes régulières pour prévenir la perte de données des prospects.

## Sauvegarde automatique / manuelle

Le script de sauvegarde se trouve dans `scripts/backup.sh`. 

### Pour sauvegarder la base locale (dev)
```bash
bun run db:backup
# Ou directement :
./scripts/backup.sh --local
```

### Pour sauvegarder la base de production (PROD)
```bash
bun run db:backup:prod
# Ou directement :
./scripts/backup.sh --remote
```

Les fichiers SQL exportés seront stockés dans le dossier `/backups` généré à la racine.

## Restauration

Si une restauration d'urgence est nécessaire à partir d'un fichier de sauvegarde :

### Vers l'environnement Local
```bash
npx wrangler d1 execute intralys-crm --local --file=backups/intralys_crm_YYYY-MM-DD.sql
```

### Vers l'environnement de Production
**⚠️ ATTENTION : Cela écrasera les données actuelles !**
```bash
npx wrangler d1 execute intralys-crm --remote --file=backups/intralys_crm_YYYY-MM-DD.sql
```

## Migration Tracker

Toutes les nouvelles migrations (`migration-phase*.sql`) sont désormais gérées par un script sécurisé :
```bash
bun run db:migrate        # Local
bun run db:migrate:prod   # Production
```
Ce script vérifie la table `_migrations` et n'applique que les fichiers `.sql` qui n'ont pas encore été joués.
