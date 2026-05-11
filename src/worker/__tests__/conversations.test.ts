import { describe, it, expect, vi } from 'vitest';
import { handleGetConversations, handleUpdateConversation } from '../conversations';
import { handleCreateSnippet } from '../snippets';
import { handleInterpolateTemplate } from '../templates';
import type { Env } from '../types';

describe('Conversations Module', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
    batch: vi.fn(),
  };
  const mockEnv = { DB: mockDb } as unknown as Env;

  it('should list conversations', async () => {
    mockDb.first.mockResolvedValueOnce({ client_id: 'client_123' });
    mockDb.all.mockResolvedValueOnce({ results: [{ id: 'conv-1' }] }); // conversations
    mockDb.all.mockResolvedValueOnce({ results: [{ status: 'open', count: 1 }] }); // counts
    
    const url = new URL('http://localhost/api/conversations');
    const res = await handleGetConversations(mockEnv, { userId: 'u1', role: 'admin' }, url);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
  });

  it('should update conversation status', async () => {
    mockDb.first.mockResolvedValueOnce({ client_id: 'client_123' });
    mockDb.run.mockResolvedValueOnce({});
    mockDb.run.mockResolvedValueOnce({});

    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' })
    });
    const res = await handleUpdateConversation(req, mockEnv, { userId: 'u1', role: 'admin' }, 'conv-1');
    expect(res.status).toBe(200);
  });
});

describe('Snippets Module', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };
  const mockEnv = { DB: mockDb } as unknown as Env;

  it('should create a snippet', async () => {
    mockDb.run.mockResolvedValueOnce({});
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'Hello', shortcut: 'hi', body: 'Hello there' })
    });
    const res = await handleCreateSnippet(req, mockEnv, { userId: 'u1', role: 'admin' });
    expect(res.status).toBe(201);
  });
});

describe('Templates Module', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  const mockEnv = { DB: mockDb } as unknown as Env;

  it('should interpolate template text', async () => {
    mockDb.first.mockResolvedValueOnce({ id: 'l1', name: 'John Doe', first_name: 'John' }); // lead
    
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hi {{lead.name}}', lead_id: 'l1' })
    });
    const res = await handleInterpolateTemplate(req, mockEnv, { userId: 'u1', role: 'admin' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.text).toBe('Hi John Doe');
  });
});
