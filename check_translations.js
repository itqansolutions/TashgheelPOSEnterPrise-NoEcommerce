const fs = require('fs');
const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));
const keys = new Set();
htmlFiles.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.match(/data-i18n="([^"]+)"/g);
  if(matches) matches.forEach(m => keys.add(m.replace('data-i18n="', '').replace('"', '')));
});
const transContent = fs.readFileSync('js/translations.js', 'utf8');
// Find Arabic block
const arMatch = transContent.match(/ar:\s*\{([\s\S]+?)\},?\s*(?:en|applyTranslations|const|\n\s*\}\s*;)/);
if(!arMatch) { console.log('Could not parse AR block'); process.exit(1); }
const arBlock = arMatch[1];
const missing = [];
keys.forEach(k => {
  if(!arBlock.includes(k + ':') && !arBlock.includes('"' + k + '":') && !arBlock.includes('\'' + k + '\':')) {
    missing.push(k);
  }
});
console.log('Missing AR keys:', missing);
