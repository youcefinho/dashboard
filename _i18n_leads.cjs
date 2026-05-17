// Script additif : clés i18n pour LeadDetail.tsx + Leads.tsx dans les 4 catalogues
const fs = require('fs');

const keys = {
  // ── LeadDetail ──
  'lead.page.title': { frCA: 'Fiche lead', frFR: 'Fiche lead', en: 'Lead detail', es: 'Ficha de lead' },
  'lead.not_found.title': { frCA: 'Lead introuvable', frFR: 'Lead introuvable', en: 'Lead not found', es: 'Lead no encontrado' },
  'lead.not_found.desc': { frCA: "Ce lead n'existe pas ou a été supprimé.", frFR: "Ce lead n'existe pas ou a été supprimé.", en: 'This lead does not exist or has been deleted.', es: 'Este lead no existe o ha sido eliminado.' },
  'lead.not_found.action': { frCA: 'Retour aux leads', frFR: 'Retour aux leads', en: 'Back to leads', es: 'Volver a leads' },
  'lead.back': { frCA: 'Retour aux leads', frFR: 'Retour aux leads', en: 'Back to leads', es: 'Volver a leads' },
  'lead.action.call': { frCA: 'Appeler', frFR: 'Appeler', en: 'Call', es: 'Llamar' },
  'lead.action.schedule': { frCA: 'Planifier RDV', frFR: 'Planifier RDV', en: 'Schedule meeting', es: 'Programar cita' },
  'lead.action.create_task': { frCA: 'Créer tâche', frFR: 'Créer tâche', en: 'Create task', es: 'Crear tarea' },
  'lead.action.visit_mode': { frCA: 'Mode Visite', frFR: 'Mode Visite', en: 'Visit mode', es: 'Modo visita' },
  'lead.type.inbound': { frCA: 'Entrant', frFR: 'Entrant', en: 'Inbound', es: 'Entrante' },
  'lead.type.customer': { frCA: 'Client', frFR: 'Client', en: 'Customer', es: 'Cliente' },
  'lead.fav.add': { frCA: 'Ajouter aux favoris', frFR: 'Ajouter aux favoris', en: 'Add to favorites', es: 'Añadir a favoritos' },
  'lead.fav.remove': { frCA: 'Retirer des favoris', frFR: 'Retirer des favoris', en: 'Remove from favorites', es: 'Quitar de favoritos' },
  'lead.trash.title': { frCA: 'Déplacer vers la corbeille ?', frFR: 'Déplacer vers la corbeille ?', en: 'Move to trash?', es: '¿Mover a la papelera?' },
  'lead.trash.desc': { frCA: '{{name}} sera déplacé vers la corbeille. Vous pourrez le restaurer pendant 30 jours.', frFR: '{{name}} sera déplacé vers la corbeille. Vous pourrez le restaurer pendant 30 jours.', en: '{{name}} will be moved to trash. You can restore it within 30 days.', es: '{{name}} será movido a la papelera. Puede restaurarlo en 30 días.' },
  'lead.trash.confirm': { frCA: 'Déplacer', frFR: 'Déplacer', en: 'Move', es: 'Mover' },
  'lead.trash.success': { frCA: 'Lead déplacé vers la corbeille', frFR: 'Lead déplacé vers la corbeille', en: 'Lead moved to trash', es: 'Lead movido a la papelera' },
  'lead.trash.undo': { frCA: 'Annuler', frFR: 'Annuler', en: 'Undo', es: 'Deshacer' },
  'lead.trash.restored': { frCA: 'Lead restauré', frFR: 'Lead restauré', en: 'Lead restored', es: 'Lead restaurado' },
  'lead.trash.delete_title': { frCA: 'Supprimer le lead', frFR: 'Supprimer le lead', en: 'Delete lead', es: 'Eliminar lead' },
  'lead.field.email': { frCA: 'Email', frFR: 'Email', en: 'Email', es: 'Email' },
  'lead.field.phone': { frCA: 'Téléphone', frFR: 'Téléphone', en: 'Phone', es: 'Teléfono' },
  'lead.field.address': { frCA: 'Adresse', frFR: 'Adresse', en: 'Address', es: 'Dirección' },
  'lead.field.budget': { frCA: 'Budget', frFR: 'Budget', en: 'Budget', es: 'Presupuesto' },
  'lead.field.property_type': { frCA: 'Type propriété', frFR: 'Type propriété', en: 'Property type', es: 'Tipo propiedad' },
  'lead.field.timeline': { frCA: 'Délai', frFR: 'Délai', en: 'Timeline', es: 'Plazo' },
  'lead.field.message': { frCA: 'Message', frFR: 'Message', en: 'Message', es: 'Mensaje' },
  'lead.custom_fields.title': { frCA: 'Champs Personnalisés', frFR: 'Champs Personnalisés', en: 'Custom Fields', es: 'Campos Personalizados' },
  'lead.custom_fields.manage': { frCA: 'Gérer les champs', frFR: 'Gérer les champs', en: 'Manage fields', es: 'Gestionar campos' },
  'lead.custom_fields.empty': { frCA: 'Aucun champ personnalisé défini pour ce lead.', frFR: 'Aucun champ personnalisé défini pour ce lead.', en: 'No custom fields defined for this lead.', es: 'No hay campos personalizados para este lead.' },
  'lead.tab.details': { frCA: 'Détails', frFR: 'Détails', en: 'Details', es: 'Detalles' },
  'lead.tab.notes': { frCA: 'Notes', frFR: 'Notes', en: 'Notes', es: 'Notas' },
  'lead.tab.conversations': { frCA: 'Conversations', frFR: 'Conversations', en: 'Conversations', es: 'Conversaciones' },
  'lead.tab.scores': { frCA: 'Scores', frFR: 'Scores', en: 'Scores', es: 'Puntuaciones' },
  'lead.tab.activity': { frCA: 'Activité', frFR: 'Activité', en: 'Activity', es: 'Actividad' },
  'lead.conversations.title': { frCA: '💬 Conversations', frFR: '💬 Conversations', en: '💬 Conversations', es: '💬 Conversaciones' },
  'lead.activity.title': { frCA: '📋 Timeline complète', frFR: '📋 Timeline complète', en: '📋 Full timeline', es: '📋 Timeline completa' },
  'lead.activity.subtitle': { frCA: 'Activité · Notes · RDV · Tâches', frFR: 'Activité · Notes · RDV · Tâches', en: 'Activity · Notes · Appointments · Tasks', es: 'Actividad · Notas · Citas · Tareas' },
  'lead.notes.title': { frCA: '📝 Notes', frFR: '📝 Notes', en: '📝 Notes', es: '📝 Notas' },
  'lead.notes.legacy': { frCA: '📌 Note héritée (ancien format)', frFR: '📌 Note héritée (ancien format)', en: '📌 Legacy note (old format)', es: '📌 Nota heredada (formato antiguo)' },
  'lead.notes.convert': { frCA: 'Convertir en note', frFR: 'Convertir en note', en: 'Convert to note', es: 'Convertir en nota' },
  'lead.notes.delete': { frCA: 'Supprimer', frFR: 'Supprimer', en: 'Delete', es: 'Eliminar' },
  'lead.notes.delete_legacy': { frCA: 'Supprimer la note héritée ?', frFR: 'Supprimer la note héritée ?', en: 'Delete legacy note?', es: '¿Eliminar nota heredada?' },
  'lead.notes.placeholder': { frCA: 'Ajouter une note...', frFR: 'Ajouter une note...', en: 'Add a note...', es: 'Añadir una nota...' },
  'lead.notes.add': { frCA: 'Ajouter', frFR: 'Ajouter', en: 'Add', es: 'Añadir' },
  'lead.notes.empty': { frCA: 'Aucune note pour le moment.', frFR: 'Aucune note pour le moment.', en: 'No notes yet.', es: 'Sin notas por ahora.' },
  'lead.notes.system': { frCA: 'Système', frFR: 'Système', en: 'System', es: 'Sistema' },
  'lead.scores.title': { frCA: '📊 Scores multi-profils', frFR: '📊 Scores multi-profils', en: '📊 Multi-profile scores', es: '📊 Puntuaciones multi-perfil' },
  'lead.scores.empty': { frCA: 'Aucun score calculé. Les scores seront calculés automatiquement.', frFR: 'Aucun score calculé. Les scores seront calculés automatiquement.', en: 'No scores calculated. Scores will be computed automatically.', es: 'Sin puntuaciones. Se calcularán automáticamente.' },
  'lead.sidebar.status': { frCA: 'Statut', frFR: 'Statut', en: 'Status', es: 'Estado' },
  'lead.sidebar.opportunity': { frCA: '💰 Opportunité', frFR: '💰 Opportunité', en: '💰 Opportunity', es: '💰 Oportunidad' },
  'lead.sidebar.deal_value': { frCA: 'Valeur du deal', frFR: 'Valeur du deal', en: 'Deal value', es: 'Valor del deal' },
  'lead.sidebar.deal_add': { frCA: 'Ajouter', frFR: 'Ajouter', en: 'Add', es: 'Añadir' },
  'lead.sidebar.probability': { frCA: 'Probabilité', frFR: 'Probabilité', en: 'Probability', es: 'Probabilidad' },
  'lead.sidebar.forecast': { frCA: 'Prévision pondérée', frFR: 'Prévision pondérée', en: 'Weighted forecast', es: 'Previsión ponderada' },
  'lead.sidebar.tags': { frCA: '🏷️ Tags', frFR: '🏷️ Tags', en: '🏷️ Tags', es: '🏷️ Tags' },
  'lead.sidebar.no_tags': { frCA: 'Aucun tag', frFR: 'Aucun tag', en: 'No tags', es: 'Sin tags' },
  'lead.sidebar.tag_placeholder': { frCA: 'Nouveau tag...', frFR: 'Nouveau tag...', en: 'New tag...', es: 'Nuevo tag...' },
  'lead.sidebar.dnd': { frCA: '🔕 Ne pas déranger', frFR: '🔕 Ne pas déranger', en: '🔕 Do not disturb', es: '🔕 No molestar' },
  'lead.sidebar.dnd_sms': { frCA: 'SMS', frFR: 'SMS', en: 'SMS', es: 'SMS' },
  'lead.sidebar.dnd_calls': { frCA: 'Appels', frFR: 'Appels', en: 'Calls', es: 'Llamadas' },
  'lead.sidebar.extra': { frCA: '📋 Infos complémentaires', frFR: '📋 Infos complémentaires', en: '📋 Additional info', es: '📋 Info adicional' },
  'lead.sidebar.dob': { frCA: 'Date de naissance', frFR: 'Date de naissance', en: 'Date of birth', es: 'Fecha de nacimiento' },
  'lead.sidebar.country': { frCA: 'Pays', frFR: 'Pays', en: 'Country', es: 'País' },
  'lead.sidebar.timezone': { frCA: 'Fuseau horaire', frFR: 'Fuseau horaire', en: 'Timezone', es: 'Zona horaria' },
  'lead.sidebar.appointments': { frCA: '📅 Rendez-vous', frFR: '📅 Rendez-vous', en: '📅 Appointments', es: '📅 Citas' },
  'lead.sidebar.no_appointments': { frCA: 'Aucun RDV planifié', frFR: 'Aucun RDV planifié', en: 'No scheduled appointments', es: 'Sin citas programadas' },
  'lead.sidebar.lead_score': { frCA: '🔥 Lead Score', frFR: '🔥 Lead Score', en: '🔥 Lead Score', es: '🔥 Lead Score' },
  'lead.score.hot': { frCA: '🔥 Lead chaud — prêt à convertir', frFR: '🔥 Lead chaud — prêt à convertir', en: '🔥 Hot lead — ready to convert', es: '🔥 Lead caliente — listo para convertir' },
  'lead.score.warm': { frCA: '🟡 Lead tiède — à relancer', frFR: '🟡 Lead tiède — à relancer', en: '🟡 Warm lead — needs follow-up', es: '🟡 Lead tibio — requiere seguimiento' },
  'lead.score.cold': { frCA: '🔵 Lead froid — à nourrir', frFR: '🔵 Lead froid — à nourrir', en: '🔵 Cold lead — needs nurturing', es: '🔵 Lead frío — requiere nutrición' },
  'lead.sidebar.tasks': { frCA: '📋 Tâches', frFR: '📋 Tâches', en: '📋 Tasks', es: '📋 Tareas' },
  'lead.sidebar.no_tasks': { frCA: 'Aucune tâche liée', frFR: 'Aucune tâche liée', en: 'No linked tasks', es: 'Sin tareas asociadas' },
  'lead.sidebar.info': { frCA: 'Infos', frFR: 'Infos', en: 'Info', es: 'Info' },
  'lead.sidebar.created': { frCA: 'Créé le', frFR: 'Créé le', en: 'Created', es: 'Creado' },
  'lead.sidebar.updated': { frCA: 'Mis à jour', frFR: 'Mis à jour', en: 'Updated', es: 'Actualizado' },
  'lead.sidebar.loi25': { frCA: '⚖️ Loi 25 (Québec)', frFR: '⚖️ Loi 25 (Québec)', en: '⚖️ Law 25 (Quebec)', es: '⚖️ Ley 25 (Quebec)' },
  'lead.sidebar.export_pii': { frCA: 'Exporter données (JSON)', frFR: 'Exporter données (JSON)', en: 'Export data (JSON)', es: 'Exportar datos (JSON)' },
  'lead.sidebar.forget': { frCA: "Droit à l'oubli", frFR: "Droit à l'oubli", en: 'Right to be forgotten', es: 'Derecho al olvido' },
  'lead.forget.title': { frCA: "Droit à l'oubli (Loi 25)", frFR: "Droit à l'oubli (Loi 25)", en: 'Right to be forgotten (Law 25)', es: 'Derecho al olvido (Ley 25)' },
  'lead.forget.confirm': { frCA: 'Effacer les données', frFR: 'Effacer les données', en: 'Erase data', es: 'Borrar datos' },
  'lead.forget.success': { frCA: 'Données personnelles effacées (Loi 25)', frFR: 'Données personnelles effacées (Loi 25)', en: 'Personal data erased (Law 25)', es: 'Datos personales borrados (Ley 25)' },
  'lead.task.mark_todo': { frCA: 'Marquer comme à faire', frFR: 'Marquer comme à faire', en: 'Mark as todo', es: 'Marcar como pendiente' },
  'lead.task.mark_done': { frCA: 'Marquer comme terminée', frFR: 'Marquer comme terminée', en: 'Mark as done', es: 'Marcar como completada' },

  // ── Leads (list page) ──
  'leads.page.title': { frCA: 'Leads', frFR: 'Leads', en: 'Leads', es: 'Leads' },
  'leads.page.meta': { frCA: 'Workspace', frFR: 'Workspace', en: 'Workspace', es: 'Workspace' },
  'leads.page.description': { frCA: 'Tous vos prospects et clients en un coup d\\\'œil. Filtrez, triez, gérez.', frFR: 'Tous vos prospects et clients en un coup d\\\'œil. Filtrez, triez, gérez.', en: 'All your prospects and clients at a glance. Filter, sort, manage.', es: 'Todos sus prospectos y clientes de un vistazo. Filtre, ordene, gestione.' },
  'leads.action.new': { frCA: '+ Nouveau lead', frFR: '+ Nouveau lead', en: '+ New lead', es: '+ Nuevo lead' },
  'leads.search.placeholder': { frCA: 'Rechercher un lead...', frFR: 'Rechercher un lead...', en: 'Search a lead...', es: 'Buscar un lead...' },
  'leads.filter.all': { frCA: 'Tous', frFR: 'Tous', en: 'All', es: 'Todos' },
  'leads.filter.favorites': { frCA: '★ Favoris', frFR: '★ Favoris', en: '★ Favorites', es: '★ Favoritos' },
  'leads.count': { frCA: '{{count}} lead', frFR: '{{count}} lead', en: '{{count}} lead', es: '{{count}} lead' },
  'leads.count_plural': { frCA: '{{count}} leads', frFR: '{{count}} leads', en: '{{count}} leads', es: '{{count}} leads' },
  'leads.empty.title': { frCA: 'Aucun lead', frFR: 'Aucun lead', en: 'No leads', es: 'Sin leads' },
  'leads.empty.description': { frCA: "Vous n'avez aucun lead pour l'instant.", frFR: "Vous n'avez aucun lead pour l'instant.", en: "You don't have any leads yet.", es: 'No tiene leads aún.' },
  'leads.empty.search_title': { frCA: 'Aucun résultat', frFR: 'Aucun résultat', en: 'No results', es: 'Sin resultados' },
  'leads.empty.search_desc': { frCA: 'Aucun lead ne correspond à « {{query}} »', frFR: 'Aucun lead ne correspond à « {{query}} »', en: 'No lead matches "{{query}}"', es: 'Ningún lead coincide con "{{query}}"' },
  'leads.table.name': { frCA: 'Nom', frFR: 'Nom', en: 'Name', es: 'Nombre' },
  'leads.table.client': { frCA: 'Client', frFR: 'Client', en: 'Client', es: 'Cliente' },
  'leads.table.status': { frCA: 'Statut', frFR: 'Statut', en: 'Status', es: 'Estado' },
  'leads.table.source': { frCA: 'Source', frFR: 'Source', en: 'Source', es: 'Fuente' },
  'leads.table.value': { frCA: 'Valeur', frFR: 'Valeur', en: 'Value', es: 'Valor' },
  'leads.table.score': { frCA: 'Score', frFR: 'Score', en: 'Score', es: 'Puntuación' },
  'leads.table.date': { frCA: 'Date', frFR: 'Date', en: 'Date', es: 'Fecha' },
  'leads.modal.title': { frCA: 'Nouveau lead', frFR: 'Nouveau lead', en: 'New lead', es: 'Nuevo lead' },
  'leads.modal.name': { frCA: 'Nom complet', frFR: 'Nom complet', en: 'Full name', es: 'Nombre completo' },
  'leads.modal.email': { frCA: 'Email', frFR: 'Email', en: 'Email', es: 'Email' },
  'leads.modal.phone': { frCA: 'Téléphone', frFR: 'Téléphone', en: 'Phone', es: 'Teléfono' },
  'leads.modal.type': { frCA: 'Type', frFR: 'Type', en: 'Type', es: 'Tipo' },
  'leads.modal.client': { frCA: 'Client', frFR: 'Client', en: 'Client', es: 'Cliente' },
  'leads.modal.cancel': { frCA: 'Annuler', frFR: 'Annuler', en: 'Cancel', es: 'Cancelar' },
  'leads.modal.submit': { frCA: 'Créer le lead', frFR: 'Créer le lead', en: 'Create lead', es: 'Crear lead' },
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
    const insert = `\n  // ── LeadDetail + Leads pages (Lot C S-C1) ──────────────────────────────\n${lines.join('\n')}\n`;
    content = content.slice(0, idx) + insert + content.slice(idx);
    fs.writeFileSync(filePath, content);
    console.log(`${locale}: ${added} clés lead/leads ajoutées`);
  } else {
    console.log(`${locale}: toutes les clés existent déjà`);
  }
}
