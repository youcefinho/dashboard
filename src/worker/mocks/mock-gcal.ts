// ── Mock Google Calendar — fixtures statiques d'événements ──

export interface MockCalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: string;
}

function getRelativeDate(daysOffset: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function getMockCalendarEvents(): MockCalendarEvent[] {
  return [
    {
      id: 'gcal-mock-1', summary: 'RDV — Sophie Tremblay (Première rencontre)',
      description: 'Lead: sophie@email.com\nTél: 819-555-1001',
      start: { dateTime: getRelativeDate(1, 10), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(1, 11), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-2', summary: 'RDV — Marc Bélanger (Estimation propriété)',
      description: 'Lead: marc@email.com\nTél: 819-555-1002',
      start: { dateTime: getRelativeDate(2, 14), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(2, 15), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-3', summary: 'Visite — 123 rue Principale, Aylmer',
      description: 'Visite avec Julie Paquette',
      start: { dateTime: getRelativeDate(3, 9), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(3, 10), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-4', summary: 'Appel — Pierre Lavoie (Suivi offre)',
      description: 'Offre conditionnelle en cours',
      start: { dateTime: getRelativeDate(0, 15), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(0, 15.5), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-5', summary: 'Réunion équipe Intralys',
      description: 'Sync hebdomadaire',
      start: { dateTime: getRelativeDate(4, 8), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(4, 9), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-6', summary: 'Signature — Condo Hull',
      description: 'Signature chez le notaire pour Pierre Lavoie',
      start: { dateTime: getRelativeDate(7, 10), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(7, 12), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-7', summary: 'RDV — Isabelle Roy (Terrain Cantley)',
      description: 'Lead: isabelle@email.com',
      start: { dateTime: getRelativeDate(-1, 14), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(-1, 15), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
    {
      id: 'gcal-mock-8', summary: 'Journée portes ouvertes — 456 boul. Gréber',
      description: 'Open house samedi matin',
      start: { dateTime: getRelativeDate(5, 10), timeZone: 'America/Toronto' },
      end: { dateTime: getRelativeDate(5, 14), timeZone: 'America/Toronto' },
      status: 'confirmed'
    },
  ];
}
