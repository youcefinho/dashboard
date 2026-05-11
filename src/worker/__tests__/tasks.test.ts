import { describe, it, expect, beforeEach, vi } from 'vitest';

import { 
  handleCreateTask,
  handleCreateSubtask,
  handleCreateTaskComment,
  handleCreateTaskTemplate
} from '../tasks';

describe('Tasks Module', () => {
  let env: any;
  const auth = { userId: 'admin-123', role: 'admin' };

  beforeEach(() => {
    env = {
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [{ id: 'mock-id', title: 'Test' }] }),
        first: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      }
    };
  });

  it('Create task -> return 201 + ID', async () => {
    const req = new Request('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'New task', priority: 'high' })
    });
    const res = await handleCreateTask(req, env, auth);
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.data.id).toBeDefined();
  });

  it('Create subtask -> return 201 + ID', async () => {
    const req = new Request('http://localhost/api/tasks/mock-task-id/subtasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Subtask 1' })
    });
    const res = await handleCreateSubtask(req, env, 'mock-task-id');
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.data.id).toBeDefined();
  });

  it('Create task comment -> return 201 + ID', async () => {
    const req = new Request('http://localhost/api/tasks/mock-task-id/comments', {
      method: 'POST',
      body: JSON.stringify({ body: 'Comment body' })
    });
    const res = await handleCreateTaskComment(req, env, auth, 'mock-task-id');
    expect(res.status).toBe(201);
  });

  it('Create task template -> return 201 + ID', async () => {
    const req = new Request('http://localhost/api/task-templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Onboarding', subtasks: ['Etape 1', 'Etape 2'] })
    });
    const res = await handleCreateTaskTemplate(req, env, auth);
    expect(res.status).toBe(201);
  });
});
