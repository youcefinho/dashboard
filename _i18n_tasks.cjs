// Script additif : clés i18n pour Tasks.tsx dans les 4 catalogues
const fs = require('fs');

const keys = {
  'tasks.page.meta': { frCA: 'Workspace', frFR: 'Workspace', en: 'Workspace', es: 'Workspace' },
  'tasks.page.title': { frCA: 'Tâches', frFR: 'Tâches', en: 'Tasks', es: 'Tareas' },
  'tasks.page.description': { frCA: 'Gérez vos relances et engagements quotidiens. Triez par priorité, échéance ou statut.', frFR: 'Gérez vos relances et engagements quotidiens. Triez par priorité, échéance ou statut.', en: 'Manage your follow-ups and daily commitments. Sort by priority, due date or status.', es: 'Gestiona tus seguimientos y compromisos diarios. Ordena por prioridad, fecha o estado.' },
  'tasks.action.new': { frCA: 'Nouvelle tâche', frFR: 'Nouvelle tâche', en: 'New task', es: 'Nueva tarea' },
  'tasks.action.add_short': { frCA: 'Tâche', frFR: 'Tâche', en: 'Task', es: 'Tarea' },
  'tasks.kpi.total': { frCA: 'Total', frFR: 'Total', en: 'Total', es: 'Total' },
  'tasks.kpi.overdue': { frCA: 'En retard', frFR: 'En retard', en: 'Overdue', es: 'Atrasadas' },
  'tasks.kpi.today': { frCA: "Aujourd'hui", frFR: "Aujourd'hui", en: 'Today', es: 'Hoy' },
  'tasks.kpi.done': { frCA: 'Terminées', frFR: 'Terminées', en: 'Completed', es: 'Completadas' },
  'tasks.filter.all': { frCA: 'Toutes', frFR: 'Toutes', en: 'All', es: 'Todas' },
  'tasks.sort.date': { frCA: 'Date', frFR: 'Date', en: 'Date', es: 'Fecha' },
  'tasks.sort.priority': { frCA: 'Priorité', frFR: 'Priorité', en: 'Priority', es: 'Prioridad' },
  'tasks.sort.status': { frCA: 'Statut', frFR: 'Statut', en: 'Status', es: 'Estado' },
  'tasks.badge.recurring': { frCA: 'Réc.', frFR: 'Réc.', en: 'Rec.', es: 'Rec.' },
  'tasks.badge.recurring_full': { frCA: 'Récurrent', frFR: 'Récurrent', en: 'Recurring', es: 'Recurrente' },
  'tasks.empty.title': { frCA: 'Aucune tâche', frFR: 'Aucune tâche', en: 'No tasks', es: 'Sin tareas' },
  'tasks.empty.description': { frCA: "Vous n'avez aucune tâche en cours.", frFR: "Vous n'avez aucune tâche en cours.", en: 'You have no tasks in progress.', es: 'No tienes tareas en curso.' },
  'tasks.modal.title': { frCA: 'Nouvelle Tâche', frFR: 'Nouvelle Tâche', en: 'New Task', es: 'Nueva Tarea' },
  'tasks.modal.templates': { frCA: 'Modèles de tâches', frFR: 'Modèles de tâches', en: 'Task templates', es: 'Plantillas de tareas' },
  'tasks.modal.apply_template': { frCA: 'Appliquer un modèle...', frFR: 'Appliquer un modèle...', en: 'Apply a template...', es: 'Aplicar una plantilla...' },
  'tasks.modal.title_label': { frCA: 'Titre', frFR: 'Titre', en: 'Title', es: 'Título' },
  'tasks.modal.title_placeholder': { frCA: 'Ex: Envoyer le contrat', frFR: 'Ex: Envoyer le contrat', en: 'E.g. Send the contract', es: 'Ej: Enviar el contrato' },
  'tasks.modal.desc_label': { frCA: 'Description', frFR: 'Description', en: 'Description', es: 'Descripción' },
  'tasks.modal.priority_label': { frCA: 'Priorité', frFR: 'Priorité', en: 'Priority', es: 'Prioridad' },
  'tasks.modal.priority_high': { frCA: '🔴 Haute', frFR: '🔴 Haute', en: '🔴 High', es: '🔴 Alta' },
  'tasks.modal.priority_medium': { frCA: '🟡 Moyenne', frFR: '🟡 Moyenne', en: '🟡 Medium', es: '🟡 Media' },
  'tasks.modal.priority_low': { frCA: '🔵 Basse', frFR: '🔵 Basse', en: '🔵 Low', es: '🔵 Baja' },
  'tasks.modal.due_label': { frCA: 'Échéance', frFR: 'Échéance', en: 'Due date', es: 'Fecha límite' },
  'tasks.modal.recurrence_label': { frCA: 'Récurrence', frFR: 'Récurrence', en: 'Recurrence', es: 'Recurrencia' },
  'tasks.modal.recurrence_none': { frCA: 'Aucune', frFR: 'Aucune', en: 'None', es: 'Ninguna' },
  'tasks.modal.recurrence_daily': { frCA: 'Quotidienne', frFR: 'Quotidienne', en: 'Daily', es: 'Diaria' },
  'tasks.modal.recurrence_weekly': { frCA: 'Hebdomadaire', frFR: 'Hebdomadaire', en: 'Weekly', es: 'Semanal' },
  'tasks.modal.recurrence_monthly': { frCA: 'Mensuelle', frFR: 'Mensuelle', en: 'Monthly', es: 'Mensual' },
  'tasks.modal.reminder_label': { frCA: 'Rappel auto (minutes)', frFR: 'Rappel auto (minutes)', en: 'Auto reminder (minutes)', es: 'Recordatorio auto (minutos)' },
  'tasks.modal.cancel': { frCA: 'Annuler', frFR: 'Annuler', en: 'Cancel', es: 'Cancelar' },
  'tasks.modal.create': { frCA: 'Créer', frFR: 'Créer', en: 'Create', es: 'Crear' },
  'tasks.detail.title': { frCA: 'Détails de la tâche', frFR: 'Détails de la tâche', en: 'Task details', es: 'Detalles de la tarea' },
  'tasks.detail.subtasks': { frCA: 'Sous-tâches', frFR: 'Sous-tâches', en: 'Subtasks', es: 'Subtareas' },
  'tasks.detail.subtask_placeholder': { frCA: 'Nouvelle sous-tâche...', frFR: 'Nouvelle sous-tâche...', en: 'New subtask...', es: 'Nueva subtarea...' },
  'tasks.detail.add': { frCA: 'Ajouter', frFR: 'Ajouter', en: 'Add', es: 'Añadir' },
  'tasks.detail.activity': { frCA: 'Activité', frFR: 'Activité', en: 'Activity', es: 'Actividad' },
  'tasks.detail.no_comments': { frCA: 'Aucun commentaire.', frFR: 'Aucun commentaire.', en: 'No comments.', es: 'Sin comentarios.' },
  'tasks.detail.comment_placeholder': { frCA: 'Ajouter un commentaire...', frFR: 'Ajouter un commentaire...', en: 'Add a comment...', es: 'Añadir un comentario...' },
  'tasks.detail.send': { frCA: 'Envoyer', frFR: 'Envoyer', en: 'Send', es: 'Enviar' },
  'tasks.detail.delete': { frCA: 'Supprimer la tâche', frFR: 'Supprimer la tâche', en: 'Delete task', es: 'Eliminar tarea' },
  'tasks.date.ago': { frCA: 'il y a {{days}}j', frFR: 'il y a {{days}}j', en: '{{days}}d ago', es: 'hace {{days}}d' },
  'tasks.date.yesterday': { frCA: 'hier', frFR: 'hier', en: 'yesterday', es: 'ayer' },
  'tasks.date.today': { frCA: "aujourd'hui", frFR: "aujourd'hui", en: 'today', es: 'hoy' },
  'tasks.date.tomorrow': { frCA: 'demain', frFR: 'demain', en: 'tomorrow', es: 'mañana' },
  'tasks.date.in_days': { frCA: 'dans {{days}}j', frFR: 'dans {{days}}j', en: 'in {{days}}d', es: 'en {{days}}d' },
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
    const insert = `\n  // ── Tasks page (Lot C S-C1) ────────────────────────────────────────────\n${lines.join('\n')}\n`;
    content = content.slice(0, idx) + insert + content.slice(idx);
    fs.writeFileSync(filePath, content);
    console.log(`${locale}: ${added} clés tasks ajoutées`);
  } else {
    console.log(`${locale}: toutes les clés tasks existent déjà`);
  }
}
