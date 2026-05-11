import type { Env } from './types';
import { findOrCreateConversation } from './conversations';

export async function handleVoiceTwiml(request: Request, env: Env): Promise<Response> {
  // Receive incoming call from Twilio and return TwiML XML
  const formData = await request.formData();
  const to = formData.get('To') as string;
  
  // Find the client associated with the Twilio number (To)
  const client = await env.DB.prepare('SELECT id, name FROM clients WHERE phone = ? OR id IN (SELECT client_id FROM sub_accounts WHERE twilio_phone = ?)')
    .bind(to, to).first() as { id: string; name: string } | null;
    
  if (!client) {
    // Fallback TwiML if client not found
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA">Désolé, ce numéro n'est pas attribué.</Say>
</Response>`;
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
  }

  // TwiML with recording
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA">Bonjour, vous avez joint ${client.name}. Veuillez laisser un message après le bip.</Say>
  <Record action="/api/voice/webhook/record" method="POST" maxLength="120" playBeep="true" />
  <Say language="fr-CA">Merci, au revoir.</Say>
</Response>`;

  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
}

export async function handleVoiceRecording(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const from = formData.get('From') as string;
  const to = formData.get('To') as string;
  const recordingUrl = formData.get('RecordingUrl') as string;
  const recordingDuration = formData.get('RecordingDuration') as string;

  if (!recordingUrl) return new Response('OK', { status: 200 });

  try {
    // Find client
    const client = await env.DB.prepare('SELECT id FROM clients WHERE phone = ? OR id IN (SELECT client_id FROM sub_accounts WHERE twilio_phone = ?)')
      .bind(to, to).first() as { id: string } | null;
      
    if (!client) return new Response('Client not found', { status: 404 });

    // Find lead by phone
    const lead = await env.DB.prepare('SELECT id FROM leads WHERE phone = ? AND client_id = ?')
      .bind(from, client.id).first() as { id: string } | null;
      
    let leadId = lead?.id;
    if (!leadId) {
      // Create a new lead
      leadId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO leads (id, client_id, name, email, phone, source, type, status)
         VALUES (?, ?, ?, ?, ?, 'voice', 'inbound', 'new')`
      ).bind(leadId, client.id, 'Appelant Inconnu', '', from).run();
    }

    // Transcription (using OpenAI Whisper if API key is provided)
    let transcript = "Transcription non disponible.";
    if (env.OPENAI_API_KEY) {
      try {
        // Fetch audio file from Twilio
        const audioRes = await fetch(recordingUrl);
        const audioBlob = await audioRes.blob();

        // Send to OpenAI Whisper
        const whisperFormData = new FormData();
        whisperFormData.append('file', audioBlob, 'recording.wav');
        whisperFormData.append('model', 'whisper-1');
        whisperFormData.append('language', 'fr');

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
          },
          body: whisperFormData
        });

        if (whisperRes.ok) {
          const data = await whisperRes.json() as { text: string };
          if (data.text) {
            transcript = data.text;
          }
        }
      } catch (err) {
        console.error('Whisper transcription error:', err);
      }
    }

    // Save as a message
    const convId = await findOrCreateConversation(env, leadId, client.id, 'voice');
    const messageBody = `📞 Message vocal reçu (${recordingDuration}s)\n\n🎙️ Transcription:\n"${transcript}"\n\n🔗 Écouter: ${recordingUrl}.mp3`;
    
    await env.DB.prepare(
      `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by)
       VALUES (?, ?, ?, ?, 'inbound', 'voice', ?, 'delivered', ?)`
    ).bind(crypto.randomUUID(), leadId, client.id, convId, messageBody, from).run();

    // Update conversation
    await env.DB.prepare(
      `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(`Voicemail: ${transcript.substring(0, 100)}`, convId).run();

  } catch (err) {
    console.error('Voice webhook error:', err);
  }

  return new Response('OK', { status: 200 });
}
