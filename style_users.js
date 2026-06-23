const fs = require('fs');
const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));

const replaceRegex = /<div style="display:flex;align-items:center;gap:10px;">[\s\S]*?<span id="welcomeText" data-i18n="welcome">.*?<\/span>[\s\S]*?<span id="currentUserName"[^>]*>.*?<\/span>(?:[\s\S]*?<span id="userRole"[^>]*>.*?<\/span>)?[\s\S]*?<\/div>/;

const userWidgetHtml = `
        <div class="flex items-center gap-3 bg-brand-purple/5 px-4 py-2 rounded-full border border-brand-purple/20">
          <div class="w-8 h-8 rounded-full bg-gradient-to-r from-brand-purple to-purple-400 flex items-center justify-center text-white font-bold shadow-md">
            <i class="fas fa-user text-sm"></i>
          </div>
          <div class="flex flex-col">
            <span class="text-xs text-gray-500 leading-tight" id="welcomeText" data-i18n="welcome">Welcome,</span>
            <div class="flex items-center gap-2">
              <span id="currentUserName" class="text-sm font-bold text-brand-dark leading-tight">User</span>
              <span id="userRole" class="text-[10px] bg-brand-blue text-white px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">cashier</span>
            </div>
          </div>
        </div>
`;

htmlFiles.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  if (content.match(replaceRegex)) {
    content = content.replace(replaceRegex, userWidgetHtml.trim());
    fs.writeFileSync(f, content, 'utf8');
    console.log('Updated user styling in ' + f);
  }
});

// For pages that don't have userRole but have the basic span layout:
const fallbackRegex = /<span id="currentUserName"[^>]*>User<\/span>/;
htmlFiles.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  if (!content.includes('bg-brand-purple/5 px-4 py-2') && content.match(fallbackRegex)) {
    // some pages just have raw span: <span id="currentUserName" class="font-semibold">User</span>
    // Let's replace the wrapping div or parent if possible.
    // Actually, I'll manually check and we can just run the first regex for now.
  }
});
