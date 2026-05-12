import type { ZObject, Bundle, Authentication } from 'zapier-platform-core';

// Test de l'authentification via /api/public/v1/me
const test = async (z: ZObject, bundle: Bundle) => {
  const response = await z.request({
    url: `${bundle.authData.api_url}/api/public/v1/me`,
  });
  return response.data;
};

export default {
  type: 'custom',

  fields: [
    {
      key: 'api_key',
      label: 'Clé API Intralys',
      type: 'string',
      required: true,
      helpText: 'Votre clé API Intralys (commence par ILYS_...)',
    },
    {
      key: 'api_url',
      label: 'URL de l\'API',
      type: 'string',
      required: true,
      default: 'https://crm.intralys.com',
      helpText: 'URL de base de votre instance Intralys CRM',
    },
  ],

  test,

  connectionLabel: 'Intralys CRM — Client {{json.data.client_id}}',
} satisfies Authentication;
