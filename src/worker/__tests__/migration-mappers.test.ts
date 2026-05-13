import { describe, it, expect } from 'vitest';
import { 
  mapGhlContact, 
  mapGhlMessage, 
  mapGhlPipeline, 
  mapGhlOpportunity, 
  mapGhlCustomField, 
  mapGhlAppointment 
} from '../migration-ghl-mappers';
import type { GhlContact, GhlMessage, GhlPipeline, GhlOpportunity, GhlCustomField, GhlCalendarEvent } from '../migration-ghl-types';

describe('GHL Migration Mappers', () => {
  it('mapGhlContact - skip si vide', () => {
    const contact: GhlContact = { id: '123' };
    expect(mapGhlContact(contact, 'client_1')).toBeNull();
  });

  it('mapGhlContact - succès', () => {
    const contact: GhlContact = {
      id: '123',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+15551234567',
      dnd: true,
      dndSettings: {
        sms: { status: 'active' },
        email: { status: 'inactive' }
      }
    };
    const mapped = mapGhlContact(contact, 'client_1');
    expect(mapped).not.toBeNull();
    expect(mapped?.name).toBe('John Doe');
    expect(mapped?.email).toBe('john@example.com');
    expect(mapped?.dnd).toBe(1);
    expect(JSON.parse(mapped?.dnd_settings || '{}')).toEqual({ sms: true, email: false, call: false });
    expect(mapped?.external_id).toBe('123');
  });

  it('mapGhlMessage - type parsing', () => {
    const msg: GhlMessage = {
      id: 'msg1',
      type: 1, // sms
      direction: 'outbound',
      body: 'Hello'
    };
    const mapped = mapGhlMessage(msg, 'client_1', 'lead_1');
    expect(mapped.channel).toBe('sms');
    expect(mapped.direction).toBe('outbound');
  });

  it('mapGhlPipeline - sépare pipeline et stages', () => {
    const p: GhlPipeline = {
      id: 'pipe1',
      name: 'Sales',
      stages: [{ id: 'stage1', name: 'New', position: 1 }]
    };
    const mapped = mapGhlPipeline(p, 'client_1');
    expect(mapped.pipeline.name).toBe('Sales');
    expect(mapped.stages[0]?.name).toBe('New');
    expect(mapped.stages[0]?.position).toBe(1);
  });

  it('mapGhlOpportunity - status mapping', () => {
    const opp: GhlOpportunity = {
      id: 'opp1',
      name: 'Deal',
      pipelineId: 'p1',
      pipelineStageId: 's1',
      status: 'abandoned',
      monetaryValue: 5000
    };
    const mapped = mapGhlOpportunity(opp);
    expect(mapped.status).toBe('lost');
    expect(mapped.deal_value).toBe(5000);
  });

  it('mapGhlCustomField - type mapping', () => {
    const cf: GhlCustomField = {
      id: 'cf1',
      name: 'Property Value',
      dataType: 'MONETARY'
    };
    const mapped = mapGhlCustomField(cf, 'client_1');
    expect(mapped.field_type).toBe('number');
    expect(mapped.slug).toBe('property_value');
  });

  it('mapGhlAppointment - status fallback', () => {
    const appt: GhlCalendarEvent = {
      id: 'appt1',
      title: 'Meeting',
      status: 'weird-status'
    };
    const mapped = mapGhlAppointment(appt, 'client_1');
    expect(mapped.status).toBe('confirmed');
  });

  it('mapGhlContact - retourne tags si présents', () => {
    const contact: GhlContact = {
      id: '456',
      email: 'tagged@test.com',
      tags: ['VIP', 'Acheteur', '  Lead Chaud  ']
    };
    const mapped = mapGhlContact(contact, 'client_1');
    expect(mapped).not.toBeNull();
    expect(mapped?.tags).toEqual(['vip', 'acheteur', 'lead chaud']);
  });

  it('mapGhlContact - retourne customFields si présents', () => {
    const contact: GhlContact = {
      id: '789',
      phone: '+15551112222',
      customFields: [
        { id: 'cf_1', value: 'Custom Value' },
        { id: 'cf_2', value: 42 }
      ]
    };
    const mapped = mapGhlContact(contact, 'client_1');
    expect(mapped).not.toBeNull();
    expect(mapped?.customFields).toHaveLength(2);
    expect(mapped?.customFields[0]?.id).toBe('cf_1');
    expect(mapped?.customFields[0]?.value).toBe('Custom Value');
  });

  it('mapGhlContact - tags vide par défaut', () => {
    const contact: GhlContact = {
      id: '999',
      email: 'notags@test.com'
    };
    const mapped = mapGhlContact(contact, 'client_1');
    expect(mapped?.tags).toEqual([]);
    expect(mapped?.customFields).toEqual([]);
  });
});
