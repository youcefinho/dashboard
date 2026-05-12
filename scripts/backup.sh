#!/bin/bash
# Script de sauvegarde D1 (Intralys CRM)
# Utilisation: ./scripts/backup.sh [--remote | --local]

ENV_FLAG="--local"
if [ "$1" == "--remote" ]; then
  ENV_FLAG="--remote"
fi

DB_NAME="intralys-crm"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_DIR="backups"
BACKUP_FILE="${BACKUP_DIR}/intralys_crm_${DATE}.sql"

mkdir -p $BACKUP_DIR

echo "📦 Création du backup D1 pour '$DB_NAME' ($ENV_FLAG)..."
npx wrangler d1 export $DB_NAME $ENV_FLAG --output=$BACKUP_FILE

if [ $? -eq 0 ]; then
  echo "✅ Backup réussi: $BACKUP_FILE"
  # Garder les 10 derniers backups (optionnel)
  # ls -t $BACKUP_DIR/*.sql | tail -n +11 | xargs -r rm
else
  echo "❌ Erreur lors du backup."
  exit 1
fi
