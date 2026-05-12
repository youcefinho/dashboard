export function generateOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Intralys CRM Public API',
      description: 'API publique pour interagir avec Intralys CRM (Leads, Tasks, Appointments) via clés API.',
      version: '1.0.0',
    },
    servers: [
      {
        url: `${baseUrl}/api/public/v1`,
        description: 'Serveur de production'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Format: ApiKey ILYS_...'
        }
      },
      schemas: {
        Lead: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            client_id: { type: 'string' },
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            status: { type: 'string' },
            type: { type: 'string' },
            source: { type: 'string' },
            notes: { type: 'string' },
            value: { type: 'number' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            lead_id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            due_date: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ],
    paths: {
      '/leads': {
        get: {
          summary: 'Lister les leads',
          description: 'Retourne la liste des leads du client. Limité à 100 par requête.',
          operationId: 'getLeads',
          tags: ['Leads'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 }
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 }
            },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Liste des leads',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Lead' }
                      }
                    }
                  }
                }
              }
            },
            '401': {
              description: 'Non autorisé',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
            }
          }
        },
        post: {
          summary: 'Créer un lead',
          description: 'Crée un nouveau lead.',
          operationId: 'createLead',
          tags: ['Leads'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    first_name: { type: 'string' },
                    last_name: { type: 'string' },
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    source: { type: 'string' },
                    type: { type: 'string' },
                    notes: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Lead créé',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/leads/{id}': {
        get: {
          summary: 'Obtenir un lead',
          description: 'Retourne les détails d\'un lead spécifique.',
          operationId: 'getLead',
          tags: ['Leads'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Détails du lead',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/Lead' }
                    }
                  }
                }
              }
            },
            '404': {
              description: 'Lead introuvable'
            }
          }
        },
        patch: {
          summary: 'Mettre à jour un lead',
          operationId: 'updateLead',
          tags: ['Leads'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    first_name: { type: 'string' },
                    last_name: { type: 'string' },
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    status: { type: 'string' },
                    value: { type: 'number' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Lead mis à jour'
            }
          }
        }
      },
      '/tasks': {
        get: {
          summary: 'Lister les tâches',
          operationId: 'getTasks',
          tags: ['Tasks'],
          responses: {
            '200': {
              description: 'Liste des tâches',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Task' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          summary: 'Créer une tâche',
          operationId: 'createTask',
          tags: ['Tasks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lead_id: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    due_date: { type: 'string', format: 'date-time' }
                  },
                  required: ['title']
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Tâche créée'
            }
          }
        }
      }
    }
  };
}
