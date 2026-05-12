import { json } from './helpers';
import type { Env } from './types';

export async function handleHealth(env: Env, uptime_s: number): Promise<Response> {
  let dbOk = 'ok';
  let details = undefined;
  try { 
    await env.DB.prepare('SELECT 1').first(); 
  } catch (e: any) { 
    dbOk = 'error'; 
    details = e.message || 'DB connection failed';
  }
  
  if (dbOk === 'error') {
    return json({ status: 'error', db: 'error', details, version: '2.1.0', uptime_s }, 503);
  }
  
  return json({ status: 'ok', db: 'ok', version: '2.1.0', uptime_s });
}
