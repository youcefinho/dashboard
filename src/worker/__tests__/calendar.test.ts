import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import handles
import { 
  handleCreateCalendar, 
  handleGetCalendars,
  handleCreateAvailabilityRule,
  handleCreateDateOverride,
  handleGetAvailability
} from '../calendar';

describe('Calendar Engine', () => {
  let env: any;
  const auth = { userId: 'admin-123', role: 'admin' };

  beforeEach(() => {
    env = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [{ id: 'mock-id' }] }),
        first: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      }
    };
  });

  it('Create calendar -> return 201 + ID', async () => {
    const req = new Request('http://localhost/api/calendars', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Cal', color: '#ff0000' })
    });
    const res = await handleCreateCalendar(req, env, auth);
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.data.id).toBeDefined();

    const getRes = await handleGetCalendars(env, auth);
    const getJson = await getRes.json() as any;
    expect(getJson.data).toHaveLength(1);
  });

  it('Create availability rule Lun 9h-17h -> check', async () => {
    const req = new Request('http://localhost/api/availability-rules', {
      method: 'POST',
      body: JSON.stringify({ day_of_week: 1, start_time: '09:00', end_time: '17:00' })
    });
    const res = await handleCreateAvailabilityRule(req, env, auth);
    expect(res.status).toBe(201);
  });

  it('Create date override 2026-07-01 -> check', async () => {
    const req = new Request('http://localhost/api/date-overrides', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-01', is_available: false, reason: 'Fête du Canada' })
    });
    const res = await handleCreateDateOverride(req, env, auth);
    expect(res.status).toBe(201);
  });

  it('Get availability for 2026-07-01 -> empty (jour férié)', async () => {
    // Stub the first query (override)
    env.DB.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ is_available: 0 }),
      all: vi.fn().mockResolvedValue({ results: [] })
    });

    const url = new URL('http://localhost/api/availability?user_id=admin-123&date=2026-07-01');
    const res = await handleGetAvailability(env, url);
    const json = await res.json() as any;
    expect(json.data.slots).toHaveLength(0);
  });

  it('Get availability for normal day -> slots 9h-17h', async () => {
    // Stub
    env.DB.prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes('date_overrides')) {
        return { bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(null) };
      }
      if (query.includes('availability_rules')) {
        return { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [{ start_time: '09:00', end_time: '17:00' }] }) };
      }
      if (query.includes('appointments')) {
        return { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
      }
      return { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
    });

    const url = new URL('http://localhost/api/availability?user_id=admin-123&date=2026-05-12');
    const res = await handleGetAvailability(env, url);
    const json = await res.json() as any;
    expect(json.data.slots.length).toBeGreaterThan(0);
    // 9h to 17h = 8 hours * 2 slots = 16 slots
    expect(json.data.slots).toHaveLength(16);
  });
});
