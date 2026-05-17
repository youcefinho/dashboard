// Script additif : clés i18n pour Pipeline.tsx dans les 4 catalogues
const fs = require('fs');

const keys = {
  'pipeline.page.meta': { frCA: 'Workspace', frFR: 'Workspace', en: 'Workspace', es: 'Workspace' },
  'pipeline.page.title': { frCA: 'Pipeline de ventes', frFR: 'Pipeline de ventes', en: 'Sales pipeline', es: 'Pipeline de ventas' },
  'pipeline.page.highlight': { frCA: 'Pipeline', frFR: 'Pipeline', en: 'Pipeline', es: 'Pipeline' },
  'pipeline.page.description': { frCA: 'Kanban drag-and-drop, vue liste ou forecast. Suivez vos opportunités en temps réel.', frFR: 'Kanban drag-and-drop, vue liste ou forecast. Suivez vos opportunités en temps réel.', en: 'Drag-and-drop kanban, list or forecast view. Track your opportunities in real time.', es: 'Kanban drag-and-drop, vista lista o previsión. Siga sus oportunidades en tiempo real.' },
  'pipeline.loading': { frCA: 'Chargement...', frFR: 'Chargement...', en: 'Loading...', es: 'Cargando...' },
  'pipeline.kpi.value': { frCA: 'Valeur', frFR: 'Valeur', en: 'Value', es: 'Valor' },
  'pipeline.kpi.forecast': { frCA: 'Prévision', frFR: 'Prévision', en: 'Forecast', es: 'Previsión' },
  'pipeline.kpi.dormant': { frCA: 'Dormants', frFR: 'Dormants', en: 'Dormant', es: 'Inactivos' },
  'pipeline.filter.label': { frCA: 'Filtres', frFR: 'Filtres', en: 'Filters', es: 'Filtros' },
  'pipeline.filter.clear': { frCA: 'Tout effacer', frFR: 'Tout effacer', en: 'Clear all', es: 'Limpiar todo' },
  'pipeline.empty.title': { frCA: 'Aucun lead dans le pipeline', frFR: 'Aucun lead dans le pipeline', en: 'No leads in pipeline', es: 'No hay leads en el pipeline' },
  'pipeline.empty.description': { frCA: 'Vos leads apparaîtront ici une fois capturés (formulaires, webhooks, intégrations) ou ajoutés manuellement.', frFR: 'Vos leads apparaîtront ici une fois capturés (formulaires, webhooks, intégrations) ou ajoutés manuellement.', en: 'Your leads will appear here once captured (forms, webhooks, integrations) or added manually.', es: 'Sus leads aparecerán aquí una vez capturados (formularios, webhooks, integraciones) o añadidos manualmente.' },
  'pipeline.empty.action': { frCA: 'Voir mes leads', frFR: 'Voir mes leads', en: 'View my leads', es: 'Ver mis leads' },
  'pipeline.kanban.drop_here': { frCA: 'Déposez ici', frFR: 'Déposez ici', en: 'Drop here', es: 'Soltar aquí' },
  'pipeline.list.contact': { frCA: 'Contact', frFR: 'Contact', en: 'Contact', es: 'Contacto' },
  'pipeline.list.client': { frCA: 'Client', frFR: 'Client', en: 'Client', es: 'Cliente' },
  'pipeline.list.stage': { frCA: 'Stage', frFR: 'Étape', en: 'Stage', es: 'Etapa' },
  'pipeline.list.type': { frCA: 'Type', frFR: 'Type', en: 'Type', es: 'Tipo' },
  'pipeline.list.value': { frCA: 'Valeur', frFR: 'Valeur', en: 'Value', es: 'Valor' },
  'pipeline.list.score': { frCA: 'Score', frFR: 'Score', en: 'Score', es: 'Puntuación' },
  'pipeline.list.days': { frCA: 'Jours', frFR: 'Jours', en: 'Days', es: 'Días' },
  'pipeline.list.source': { frCA: 'Source', frFR: 'Source', en: 'Source', es: 'Fuente' },
  'pipeline.list.type_inbound': { frCA: 'Entrant', frFR: 'Entrant', en: 'Inbound', es: 'Entrante' },
  'pipeline.list.type_customer': { frCA: 'Client', frFR: 'Client', en: 'Customer', es: 'Cliente' },
  'pipeline.lost.title': { frCA: 'Marquer comme perdu', frFR: 'Marquer comme perdu', en: 'Mark as lost', es: 'Marcar como perdido' },
  'pipeline.lost.reason_label': { frCA: 'Raison de la perte', frFR: 'Raison de la perte', en: 'Reason for loss', es: 'Razón de la pérdida' },
  'pipeline.lost.reason_placeholder': { frCA: 'Sélectionner une raison...', frFR: 'Sélectionner une raison...', en: 'Select a reason...', es: 'Seleccionar una razón...' },
  'pipeline.lost.details_label': { frCA: 'Détails (optionnel)', frFR: 'Détails (optionnel)', en: 'Details (optional)', es: 'Detalles (opcional)' },
  'pipeline.lost.details_placeholder': { frCA: 'Notes supplémentaires...', frFR: 'Notes supplémentaires...', en: 'Additional notes...', es: 'Notas adicionales...' },
  'pipeline.lost.cancel': { frCA: 'Annuler', frFR: 'Annuler', en: 'Cancel', es: 'Cancelar' },
  'pipeline.lost.confirm': { frCA: 'Confirmer la perte', frFR: 'Confirmer la perte', en: 'Confirm loss', es: 'Confirmar pérdida' },
};

const files = {
  frCA: 'src/lib/i18n/fr-CA.ts',
  frFR: 'src/lib/i18n/fr-FR.ts',
  en: 'src/lib/i18n/en.ts',
  es: 'src/lib/i18n/es.ts',
};

for (const [locale, filePath] of Object.entries(files)) {
  let content = fs.readFileSync(filePath, 'utf8');
  let added = 0;
  const lines = [];
  for (const [key, translations] of Object.entries(keys)) {
    if (!content.includes(`'${key}'`)) {
      const value = translations[locale].replace(/'/g, "\\'");
      lines.push(`  '${key}': '${value}',`);
      added++;
    }
  }
  if (added > 0) {
    const marker = '};';
    const idx = content.lastIndexOf(marker);
    const insert = `\n  // ── Pipeline page (Lot C S-C1) ─────────────────────────────────────────\n${lines.join('\n')}\n`;
    content = content.slice(0, idx) + insert + content.slice(idx);
    fs.writeFileSync(filePath, content);
    console.log(`${locale}: ${added} clés pipeline ajoutées`);
  } else {
    console.log(`${locale}: toutes les clés pipeline existent déjà`);
  }
}
