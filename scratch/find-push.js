import fs from 'fs';

const content = fs.readFileSync('src/worker.ts', 'utf-8');
const lines = content.split('\n');

console.log('--- RECHERCHE PUSH ---');
lines.forEach((line, index) => {
  if (line.includes('handleRegisterDevice') || line.includes('handleUnregisterDevice') || line.includes('handleSendPush') || line.includes('push-token') || line.includes('sendPush')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
