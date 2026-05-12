import type { ZObject, Bundle } from 'zapier-platform-core';

// Action : Créer un lead
const perform = async (z: ZObject, bundle: Bundle) => {
  const response = await z.request({
    method: 'POST',
    url: `${bundle.authData.api_url}/api/public/v1/leads`,
    body: {
      name: bundle.inputData.name,
      email: bundle.inputData.email,
      phone: bundle.inputData.phone || '',
      source: bundle.inputData.source || 'zapier',
      type: bundle.inputData.type || 'buy',
      message: bundle.inputData.message || '',
      client_id: bundle.inputData.client_id || '',
    },
  });

  return response.data.data || response.data;
};

export default {
  key: 'create_lead',
  noun: 'Lead',

  display: {
    label: 'Créer un Lead',
    description: 'Crée un nouveau lead dans Intralys CRM.',
  },

  operation: {
    perform,

    inputFields: [
      { key: 'name', label: 'Nom complet', type: 'string' as const, required: true },
      { key: 'email', label: 'Courriel', type: 'string' as const, required: true },
      { key: 'phone', label: 'Téléphone', type: 'string' as const, required: false },
      {
        key: 'type',
        label: 'Type',
        type: 'string' as const,
        choices: { buy: 'Acheteur', sell: 'Vendeur' },
        default: 'buy',
        required: false,
      },
      { key: 'source', label: 'Source', type: 'string' as const, default: 'zapier', required: false },
      { key: 'message', label: 'Message / Note', type: 'text' as const, required: false },
      { key: 'client_id', label: 'ID du client courtier', type: 'string' as const, required: false },
    ],

    sample: {
      id: 'lead_created_123',
      name: 'Marie Lavoie',
      email: 'marie@exemple.com',
    },

    outputFields: [
      { key: 'id', label: 'ID du lead créé' },
    ],
  },
};
