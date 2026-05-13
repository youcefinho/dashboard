import type { 
  GhlContact, GhlConversation, GhlMessage, 
  GhlPipeline, GhlOpportunity, GhlCustomField, 
  GhlCalendar, GhlCalendarEvent 
} from './migration-ghl-types';

export function mapGhlContact(ghl: GhlContact, clientId: string) {
  const email = (ghl.email || '').toLowerCase().trim();
  const phone = (ghl.phone || '').trim();

  // Skip si pas d'email ni de téléphone
  if (!email && !phone) return null;

  const name = [ghl.firstName, ghl.lastName].filter(Boolean).join(' ') || 'Contact sans nom';
  
  let dnd = 0;
  let dndSettings: Record<string, boolean> = {};
  if (ghl.dnd) {
    dnd = 1;
    if (ghl.dndSettings) {
      dndSettings = {
        sms: ghl.dndSettings.sms?.status === 'active',
        email: ghl.dndSettings.email?.status === 'active',
        call: ghl.dndSettings.call?.status === 'active',
      };
    }
  }

  return {
    id: crypto.randomUUID(),
    client_id: clientId,
    name,
    email,
    phone,
    source: ghl.source || 'migration_ghl',
    type: 'inbound', // Par défaut
    status: 'new',
    dnd,
    dnd_settings: JSON.stringify(dndSettings),
    date_of_birth: ghl.dateOfBirth || null,
    country: ghl.country || 'CA',
    timezone: ghl.timezone || 'America/Toronto',
    external_id: ghl.id,
    migrated_from: 'ghl',
    created_at: ghl.dateAdded || new Date().toISOString(),
    // Tags et custom fields pour insertion dans live API
    tags: (ghl.tags || []).map(t => t.trim().toLowerCase()).filter(Boolean),
    customFields: ghl.customFields || [],
  };
}

export function mapGhlConversation(ghl: GhlConversation, clientId: string, leadId: string) {
  // Optionnel : Intralys CRM n'a pas nécessairement de table `conversations` séparée (il utilise le lead_id)
  // Mais si nécessaire, on retourne un objet formaté
  return {
    id: crypto.randomUUID(),
    client_id: clientId,
    lead_id: leadId,
    external_id: ghl.id,
    created_at: ghl.dateAdded || new Date().toISOString()
  };
}

export function mapGhlMessage(ghl: GhlMessage, clientId: string, leadId: string) {
  const channelMap: Record<number, string> = {
    1: 'sms',
    2: 'email', // On suppose que 2 est parfois email selon les vieilles APIs
    3: 'call',
    4: 'email',
    5: 'webchat',
    25: 'facebook',
    26: 'instagram',
    29: 'webchat',
  };

  const channel = channelMap[ghl.type || 0] || 'email'; // fallback email
  const direction = ghl.direction === 'outbound' ? 'outbound' : 'inbound';

  return {
    id: crypto.randomUUID(),
    client_id: clientId,
    lead_id: leadId,
    direction,
    channel,
    body: ghl.body || '',
    status: ghl.status || 'delivered',
    sent_by: 'ghl_import',
    external_id: ghl.id,
    created_at: ghl.dateAdded || new Date().toISOString()
  };
}

export function mapGhlPipeline(ghl: GhlPipeline, clientId: string) {
  const pipelineId = crypto.randomUUID();
  const stages = (ghl.stages || []).map(s => ({
    id: crypto.randomUUID(),
    pipeline_id: pipelineId,
    name: s.name,
    position: s.position,
    external_id: s.id
  }));

  return {
    pipeline: {
      id: pipelineId,
      client_id: clientId,
      name: ghl.name,
      external_id: ghl.id
    },
    stages
  };
}

export function mapGhlOpportunity(ghl: GhlOpportunity) {
  const statusMap: Record<string, string> = {
    'open': 'qualified',
    'won': 'won',
    'lost': 'lost',
    'abandoned': 'lost',
  };

  return {
    external_id: ghl.id,
    pipeline_external_id: ghl.pipelineId,
    stage_external_id: ghl.pipelineStageId,
    status: statusMap[ghl.status] || 'qualified',
    deal_value: ghl.monetaryValue || 0,
    contact_external_id: ghl.contact?.id,
    created_at: ghl.dateAdded || new Date().toISOString()
  };
}

export function mapGhlCustomField(ghl: GhlCustomField, clientId: string) {
  const typeMap: Record<string, string> = {
    'TEXT': 'text',
    'LARGE_TEXT': 'textarea',
    'NUMERICAL': 'number',
    'MONETARY': 'number',
    'PHONE': 'phone',
    'DATE': 'date',
    'SINGLE_OPTIONS': 'select',
    'MULTIPLE_OPTIONS': 'multiselect',
    'CHECKBOX': 'checkbox',
    'TEXTAREA': 'textarea',
    'FILE_UPLOAD': 'file',
    'SIGNATURE': 'text'
  };

  const fieldType = typeMap[ghl.dataType] || 'text';
  const slug = ghl.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  return {
    id: crypto.randomUUID(),
    client_id: clientId,
    name: ghl.name,
    slug,
    field_type: fieldType,
    options: ghl.picklistOptions ? JSON.stringify(ghl.picklistOptions) : '[]',
    sort_order: ghl.position || 0,
    external_id: ghl.id
  };
}

export function mapGhlCalendar(ghl: GhlCalendar, clientId: string) {
  return {
    id: crypto.randomUUID(),
    client_id: clientId,
    name: ghl.name,
    description: ghl.description || '',
    external_id: ghl.id
  };
}

export function mapGhlAppointment(ghl: GhlCalendarEvent, clientId: string) {
  const validStatuses = ['confirmed', 'cancelled', 'no-show', 'completed'];
  const status = validStatuses.includes(ghl.status || '') ? ghl.status : 'confirmed';

  return {
    id: crypto.randomUUID(),
    client_id: clientId,
    title: ghl.title || 'Rendez-vous importé',
    start_time: ghl.startTime || new Date().toISOString(),
    end_time: ghl.endTime || new Date().toISOString(),
    status,
    contact_external_id: ghl.contactId,
    calendar_external_id: ghl.calendarId,
    external_id: ghl.id,
    created_at: new Date().toISOString()
  };
}
