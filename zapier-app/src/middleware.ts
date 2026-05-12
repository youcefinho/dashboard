import type { ZObject, Bundle, HttpRequestOptions, HttpResponse, BeforeRequestMiddleware, AfterResponseMiddleware } from 'zapier-platform-core';

// Injecte le header Authorization: ApiKey <token> sur toutes les requêtes
const addApiKeyHeader: BeforeRequestMiddleware = (
  request,
  _z,
  bundle
) => {
  if (bundle.authData.api_key) {
    request.headers = {
      ...request.headers,
      Authorization: `ApiKey ${bundle.authData.api_key}`,
    };
  }
  return request as HttpRequestOptions & { url: string };
};

// Gestion 401 → invalidation de l'auth
const handleUnauthorized: AfterResponseMiddleware = (
  response,
  z,
  _bundle
) => {
  if (response.status === 401) {
    throw new z.errors.RefreshAuthError('Clé API invalide ou expirée. Reconnectez votre compte Intralys.');
  }
  return response;
};

export const befores = [addApiKeyHeader];
export const afters = [handleUnauthorized];
