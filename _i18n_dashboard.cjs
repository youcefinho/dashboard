// Script additif : clés i18n pour Dashboard.tsx dans les 4 catalogues
const fs = require('fs');

const keys = {
  'dashboard.page.title': { frCA: 'Dashboard', frFR: 'Tableau de bord', en: 'Dashboard', es: 'Panel' },
  'dashboard.period.days': { frCA: '{{days}} derniers jours', frFR: '{{days}} derniers jours', en: 'Last {{days}} days', es: 'Últimos {{days}} días' },
  'dashboard.greeting.morning': { frCA: 'Bonjour', frFR: 'Bonjour', en: 'Good morning', es: 'Buenos días' },
  'dashboard.greeting.afternoon': { frCA: 'Bon après-midi', frFR: 'Bon après-midi', en: 'Good afternoon', es: 'Buenas tardes' },
  'dashboard.greeting.evening': { frCA: 'Bonsoir', frFR: 'Bonsoir', en: 'Good evening', es: 'Buenas noches' },
  'dashboard.subtitle': { frCA: "Voici la vue d'ensemble de votre activité.", frFR: "Voici la vue d'ensemble de votre activité.", en: 'Here is an overview of your activity.', es: 'Aquí tiene una vista general de su actividad.' },
  'dashboard.period.7d': { frCA: '7j', frFR: '7j', en: '7d', es: '7d' },
  'dashboard.period.30d': { frCA: '30j', frFR: '30j', en: '30d', es: '30d' },
  'dashboard.period.90d': { frCA: '90j', frFR: '90j', en: '90d', es: '90d' },
  'dashboard.action.export': { frCA: 'Exporter', frFR: 'Exporter', en: 'Export', es: 'Exportar' },
  'dashboard.action.configure': { frCA: 'Configurer les widgets', frFR: 'Configurer les widgets', en: 'Configure widgets', es: 'Configurar widgets' },
  'dashboard.config.title': { frCA: 'Personnaliser le dashboard', frFR: 'Personnaliser le tableau de bord', en: 'Customize dashboard', es: 'Personalizar panel' },
  'dashboard.config.reset': { frCA: 'Réinitialiser', frFR: 'Réinitialiser', en: 'Reset', es: 'Restablecer' },
  'dashboard.config.show': { frCA: 'Afficher', frFR: 'Afficher', en: 'Show', es: 'Mostrar' },
  'dashboard.config.hide': { frCA: 'Masquer', frFR: 'Masquer', en: 'Hide', es: 'Ocultar' },
  'dashboard.stat.contacts': { frCA: 'Total contacts', frFR: 'Total contacts', en: 'Total contacts', es: 'Total contactos' },
  'dashboard.stat.pipeline_value': { frCA: 'Pipeline value', frFR: 'Valeur pipeline', en: 'Pipeline value', es: 'Valor pipeline' },
  'dashboard.stat.conversion': { frCA: 'Taux conversion', frFR: 'Taux de conversion', en: 'Conversion rate', es: 'Tasa de conversión' },
  'dashboard.stat.revenue': { frCA: 'Revenu (Mois)', frFR: 'Revenu (Mois)', en: 'Revenue (Month)', es: 'Ingresos (Mes)' },
  'dashboard.client.add': { frCA: 'Ajouter', frFR: 'Ajouter', en: 'Add', es: 'Añadir' },
  'dashboard.chart.title': { frCA: 'Acquisition de leads', frFR: 'Acquisition de leads', en: 'Lead acquisition', es: 'Adquisición de leads' },
  'dashboard.chart.subtitle': { frCA: '{{days}} derniers jours par source', frFR: '{{days}} derniers jours par source', en: 'Last {{days}} days by source', es: 'Últimos {{days}} días por fuente' },
  'dashboard.chart.website': { frCA: 'Site web', frFR: 'Site web', en: 'Website', es: 'Sitio web' },
  'dashboard.chart.facebook': { frCA: 'Facebook', frFR: 'Facebook', en: 'Facebook', es: 'Facebook' },
  'dashboard.chart.referral': { frCA: 'Référence', frFR: 'Référence', en: 'Referral', es: 'Referencia' },
  'dashboard.activity.title': { frCA: 'Activité récente', frFR: 'Activité récente', en: 'Recent activity', es: 'Actividad reciente' },
  'dashboard.activity.empty': { frCA: 'Aucune activité', frFR: 'Aucune activité', en: 'No activity', es: 'Sin actividad' },
  'dashboard.activity.view_all': { frCA: "Voir toute l'activité →", frFR: "Voir toute l'activité →", en: 'View all activity →', es: 'Ver toda la actividad →' },
  'dashboard.pipeline.title': { frCA: 'Répartition pipeline', frFR: 'Répartition pipeline', en: 'Pipeline breakdown', es: 'Distribución pipeline' },
  'dashboard.pipeline.empty': { frCA: 'Aucune donnée pipeline', frFR: 'Aucune donnée pipeline', en: 'No pipeline data', es: 'Sin datos de pipeline' },
  'dashboard.sources.title': { frCA: '🔗 Top sources', frFR: '🔗 Top sources', en: '🔗 Top sources', es: '🔗 Top fuentes' },
  'dashboard.sources.empty': { frCA: 'Aucune donnée', frFR: 'Aucune donnée', en: 'No data', es: 'Sin datos' },
  'dashboard.sources.website': { frCA: '🌐 Site web', frFR: '🌐 Site web', en: '🌐 Website', es: '🌐 Sitio web' },
  'dashboard.sources.facebook': { frCA: '📘 Facebook', frFR: '📘 Facebook', en: '📘 Facebook', es: '📘 Facebook' },
  'dashboard.sources.google': { frCA: '🔍 Google', frFR: '🔍 Google', en: '🔍 Google', es: '🔍 Google' },
  'dashboard.sources.referral': { frCA: '🤝 Référence', frFR: '🤝 Référence', en: '🤝 Referral', es: '🤝 Referencia' },
  'dashboard.sources.direct': { frCA: '🔗 Direct', frFR: '🔗 Direct', en: '🔗 Direct', es: '🔗 Directo' },
  'dashboard.sources.instagram': { frCA: '📷 Instagram', frFR: '📷 Instagram', en: '📷 Instagram', es: '📷 Instagram' },
  'dashboard.contacts.title': { frCA: 'Derniers contacts', frFR: 'Derniers contacts', en: 'Recent contacts', es: 'Últimos contactos' },
  'dashboard.contacts.subtitle': { frCA: '{{count}} contacts actifs cette semaine', frFR: '{{count}} contacts actifs cette semaine', en: '{{count}} active contacts this week', es: '{{count}} contactos activos esta semana' },
  'dashboard.contacts.view_all': { frCA: 'Voir tout', frFR: 'Voir tout', en: 'View all', es: 'Ver todo' },
  'dashboard.contacts.col_contact': { frCA: 'Contact', frFR: 'Contact', en: 'Contact', es: 'Contacto' },
  'dashboard.contacts.col_status': { frCA: 'Statut', frFR: 'Statut', en: 'Status', es: 'Estado' },
  'dashboard.contacts.col_source': { frCA: 'Source', frFR: 'Source', en: 'Source', es: 'Fuente' },
  'dashboard.contacts.col_value': { frCA: 'Valeur', frFR: 'Valeur', en: 'Value', es: 'Valor' },
  'dashboard.contacts.col_score': { frCA: 'Score', frFR: 'Score', en: 'Score', es: 'Puntuación' },
  'dashboard.contacts.col_activity': { frCA: 'Activité', frFR: 'Activité', en: 'Activity', es: 'Actividad' },
  'dashboard.error.retry': { frCA: 'Réessayer', frFR: 'Réessayer', en: 'Retry', es: 'Reintentar' },
  'dashboard.time.min_ago': { frCA: 'il y a {{n}} min', frFR: 'il y a {{n}} min', en: '{{n}} min ago', es: 'hace {{n}} min' },
  'dashboard.time.hours_ago': { frCA: 'il y a {{n}}h', frFR: 'il y a {{n}}h', en: '{{n}}h ago', es: 'hace {{n}}h' },
  'dashboard.time.1d_ago': { frCA: 'il y a 1j', frFR: 'il y a 1j', en: '1d ago', es: 'hace 1d' },
  'dashboard.time.days_ago': { frCA: 'il y a {{n}}j', frFR: 'il y a {{n}}j', en: '{{n}}d ago', es: 'hace {{n}}d' },
  'dashboard.source.website': { frCA: 'Site web', frFR: 'Site web', en: 'Website', es: 'Sitio web' },
  'dashboard.source.facebook': { frCA: 'Facebook', frFR: 'Facebook', en: 'Facebook', es: 'Facebook' },
  'dashboard.source.facebook_ads': { frCA: 'Facebook Ads', frFR: 'Facebook Ads', en: 'Facebook Ads', es: 'Facebook Ads' },
  'dashboard.source.direct': { frCA: 'Direct', frFR: 'Direct', en: 'Direct', es: 'Directo' },
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
    const insert = `\n  // ── Dashboard page (Lot C S-C1) ────────────────────────────────────────\n${lines.join('\n')}\n`;
    content = content.slice(0, idx) + insert + content.slice(idx);
    fs.writeFileSync(filePath, content);
    console.log(`${locale}: ${added} clés dashboard ajoutées`);
  } else {
    console.log(`${locale}: toutes les clés dashboard existent déjà`);
  }
}
