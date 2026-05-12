import type { ZObject, Bundle } from 'zapier-platform-core';

// Trigger : Nouveau lead (polling)
const perform = async (z: ZObject, bundle: Bundle) => {
  const response = await z.request({
    url: `${bundle.authData.api_url}/api/public/v1/leads`,
    params: {
      sort: 'newest',
      limit: '25',
    },
  });

  // Le handler retourne { data: [...], next_cursor: ... }
  return response.data.data || [];
};

export default {
  key: 'new_lead',
  noun: 'Lead',

  display: {
    label: 'Nouveau Lead',
    description: 'Se déclenche quand un nouveau lead est créé dans Intralys CRM.',
  },

  operation: {
    perform,

    // Données exemples pour le mapping dans Zapier
    sample: {
      id: 'lead_sample_123',
      name: 'Jean Tremblay',
      email: 'jean@exemple.com',
      phone: '+15141234567',
      status: 'new',
      source: 'website',
      client_id: 'client_1',
      created_at: '2026-01-15T10:30:00Z',
    },

    outputFields: [
      { key: 'id', label: 'ID du lead' },
      { key: 'name', label: 'Nom complet' },
      { key: 'email', label: 'Courriel' },
      { key: 'phone', label: 'Téléphone' },
      { key: 'status', label: 'Statut' },
      { key: 'source', label: 'Source' },
      { key: 'client_id', label: 'ID du client' },
      { key: 'created_at', label: 'Date de création' },
    ],
  },
};
