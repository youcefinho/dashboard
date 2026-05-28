import fs from 'fs';
import path from 'path';

const docDir = 'docs';
const files = fs.readdirSync(docDir);

console.log('--- RECHERCHE SPRINT 62 ---');
files.forEach(file => {
  if (file.endsWith('.md') || file.endsWith('.json')) {
    const content = fs.readFileSync(path.join(docDir, file), 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('Sprint 62') || line.includes('S62') || line.includes('upsell') || line.includes('Upsell')) {
        console.log(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
});
