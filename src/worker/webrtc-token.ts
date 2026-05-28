// ── webrtc-token.ts — Sprint 58 Softphone SIP WebRTC Intégré ──
//
// Génère un jeton d'accès Twilio Access Token pour le Softphone WebRTC.
// Signature JWT manuelle en Web Crypto API pour compatibilité Edge Worker.
// Si credentials absents, retourne un mock-token.

import type { Env } from './types';
import { json } from './helpers';

// Helper pour signer un JWT en HMAC-SHA256 avec la clé d'API secrète Twilio
async function signJwt(payload: any, secret: string, keyId: string): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    cty: 'twilio-fpa;v=1',
    kid: keyId
  };

  const base64UrlEncode = (obj: any) => {
    const str = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary)
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };

  const headerPart = base64UrlEncode(header);
  const payloadPart = base64UrlEncode(payload);
  const dataToSign = `${headerPart}.${payloadPart}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(dataToSign));
  let binary = '';
  const bytes = new Uint8Array(signatureBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const signaturePart = btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${dataToSign}.${signaturePart}`;
}

export async function handleGetTwilioWebrtcToken(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  // Mode Mock/Bypass si credentials absents
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY || !env.TWILIO_API_SECRET) {
    return json({
      data: {
        token: `mock_webrtc_token_for_${auth.userId}_${Date.now()}`,
        identity: auth.userId,
        mock: true
      }
    });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 heure

    const payload = {
      jti: `${env.TWILIO_API_KEY}-${now}-${Math.floor(Math.random() * 100000)}`,
      iss: env.TWILIO_API_KEY,
      sub: env.TWILIO_ACCOUNT_SID,
      nbf: now - 30,
      iat: now,
      exp: exp,
      grants: {
        identity: auth.userId,
        voice: {
          incoming: {
            allow: true
          },
          outgoing: {
            application_sid: env.TWILIO_TWIML_APP_SID || ''
          }
        }
      }
    };

    const token = await signJwt(payload, env.TWILIO_API_SECRET, env.TWILIO_API_KEY);

    return json({
      data: {
        token,
        identity: auth.userId,
        expires_at: new Date(exp * 1000).toISOString()
      }
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
