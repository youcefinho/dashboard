// Script additif : clés i18n pour Clients.tsx dans les 4 catalogues
const fs = require('fs');

const keys = {
  'clients.page.meta': { frCA: 'Workspace', frFR: 'Workspace', en: 'Workspace', es: 'Workspace' },
  'clients.page.title': { frCA: 'Clients', frFR: 'Clients', en: 'Clients', es: 'Clientes' },
  'clients.page.description': { frCA: 'Vos sous-comptes : agences, équipes ou entreprises gérées. Chaque client = environnement isolé.', frFR: 'Vos sous-comptes : agences, équipes ou entreprises gérées. Chaque client = environnement isolé.', en: 'Your sub-accounts: agencies, teams or managed businesses. Each client = isolated environment.', es: 'Sus subcuentas: agencias, equipos o empresas gestionadas. Cada cliente = entorno aislado.' },
  'clients.kpi.sub_accounts': { frCA: 'Sous-comptes', frFR: 'Sous-comptes', en: 'Sub-accounts', es: 'Subcuentas' },
  'clients.kpi.total_leads': { frCA: 'Leads total', frFR: 'Leads total', en: 'Total leads', es: 'Leads totales' },
  'clients.kpi.won': { frCA: 'Gagnés', frFR: 'Gagnés', en: 'Won', es: 'Ganados' },
  'clients.kpi.pipeline_total': { frCA: 'Pipeline total', frFR: 'Pipeline total', en: 'Total pipeline', es: 'Pipeline total' },
  'clients.search.placeholder': { frCA: 'Rechercher un compte...', frFR: 'Rechercher un compte...', en: 'Search an account...', es: 'Buscar una cuenta...' },
  'clients.action.new': { frCA: '+ Nouveau client', frFR: '+ Nouveau client', en: '+ New client', es: '+ Nuevo cliente' },
  'clients.empty.no_result_title': { frCA: 'Aucun résultat', frFR: 'Aucun résultat', en: 'No results', es: 'Sin resultados' },
  'clients.empty.no_client_title': { frCA: 'Aucun client', frFR: 'Aucun client', en: 'No clients', es: 'Sin clientes' },
  'clients.empty.no_result_desc': { frCA: 'Aucun compte ne correspond à « {{query}} »', frFR: 'Aucun compte ne correspond à « {{query}} »', en: 'No account matches "{{query}}"', es: 'Ninguna cuenta coincide con "{{query}}"' },
  'clients.empty.no_client_desc': { frCA: 'Ajoutez votre premier compte pour commencer.', frFR: 'Ajoutez votre premier compte pour commencer.', en: 'Add your first account to get started.', es: 'Añade tu primera cuenta para empezar.' },
  'clients.empty.add_client': { frCA: 'Ajouter un client', frFR: 'Ajouter un client', en: 'Add a client', es: 'Añadir un cliente' },
  'clients.card.city_undefined': { frCA: 'Ville non définie', frFR: 'Ville non définie', en: 'City not set', es: 'Ciudad no definida' },
  'clients.card.active': { frCA: 'Actif', frFR: 'Actif', en: 'Active', es: 'Activo' },
  'clients.card.inactive': { frCA: 'Inactif', frFR: 'Inactif', en: 'Inactive', es: 'Inactivo' },
  'clients.card.leads': { frCA: 'Leads', frFR: 'Leads', en: 'Leads', es: 'Leads' },
  'clients.card.conv': { frCA: 'Conv.', frFR: 'Conv.', en: 'Conv.', es: 'Conv.' },
  'clients.card.pipeline': { frCA: 'Pipeline', frFR: 'Pipeline', en: 'Pipeline', es: 'Pipeline' },
  'clients.card.site': { frCA: 'Site', frFR: 'Site', en: 'Website', es: 'Sitio' },
  'clients.modal.title': { frCA: 'Ajouter un client', frFR: 'Ajouter un client', en: 'Add a client', es: 'Añadir un cliente' },
  'clients.modal.name_label': { frCA: "Nom de l'entreprise / client", frFR: "Nom de l'entreprise / client", en: 'Company / client name', es: 'Nombre de empresa / cliente' },
  'clients.modal.name_placeholder': { frCA: 'Ex: Lumière Nettoyage Pro', frFR: 'Ex: Lumière Nettoyage Pro', en: 'E.g. Lumière Cleaning Pro', es: 'Ej: Lumière Limpieza Pro' },
  'clients.modal.email_label': { frCA: 'Email', frFR: 'Email', en: 'Email', es: 'Email' },
  'clients.modal.email_placeholder': { frCA: 'contact@entreprise.com', frFR: 'contact@entreprise.com', en: 'contact@company.com', es: 'contacto@empresa.com' },
  'clients.modal.phone_label': { frCA: 'Téléphone', frFR: 'Téléphone', en: 'Phone', es: 'Teléfono' },
  'clients.modal.phone_placeholder': { frCA: '514-555-1234', frFR: '01 23 45 67 89', en: '514-555-1234', es: '514-555-1234' },
  'clients.modal.city_label': { frCA: 'Ville', frFR: 'Ville', en: 'City', es: 'Ciudad' },
  'clients.modal.city_placeholder': { frCA: 'Montréal', frFR: 'Paris', en: 'Montreal', es: 'Montreal' },
  'clients.modal.banner_label': { frCA: 'Bannière / Industrie', frFR: 'Bannière / Industrie', en: 'Banner / Industry', es: 'Banner / Industria' },
  'clients.modal.banner_placeholder': { frCA: 'Ex: Nettoyage', frFR: 'Ex: Nettoyage', en: 'E.g. Cleaning', es: 'Ej: Limpieza' },
  'clients.modal.site_label': { frCA: 'URL du site', frFR: 'URL du site', en: 'Website URL', es: 'URL del sitio' },
  'clients.modal.site_placeholder': { frCA: 'https://lumiere-nettoyage.com', frFR: 'https://lumiere-nettoyage.com', en: 'https://lumiere-cleaning.com', es: 'https://lumiere-limpieza.com' },
  'clients.modal.cancel': { frCA: 'Annuler', frFR: 'Annuler', en: 'Cancel', es: 'Cancelar' },
  'clients.modal.submit': { frCA: 'Ajouter', frFR: 'Ajouter', en: 'Add', es: 'Añadir' },
  'clients.count': { frCA: '{{count}} compte', frFR: '{{count}} compte', en: '{{count}} account', es: '{{count}} cuenta' },
  'clients.count_plural': { frCA: '{{count}} comptes', frFR: '{{count}} comptes', en: '{{count}} accounts', es: '{{count}} cuentas' },
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
    const insert = `\n  // ── Clients page (Lot C S-C1) ──────────────────────────────────────────\n${lines.join('\n')}\n`;
    content = content.slice(0, idx) + insert + content.slice(idx);
    fs.writeFileSync(filePath, content);
    console.log(`${locale}: ${added} clés clients ajoutées`);
  } else {
    console.log(`${locale}: toutes les clés clients existent déjà`);
  }
}
