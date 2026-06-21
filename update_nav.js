const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'super-admin.html' && f !== 'index.html' && f !== 'register.html' && f !== 'subscription.html' && f !== 'ecommerce.html' && f !== 'online-orders.html');

const items = [
  { href: 'pos.html', icon: '🛒', key: 'nav_pos', text: 'Point of Sale' },
  { href: 'products.html', icon: '📦', key: 'nav_products', text: 'Products' },
  { href: 'inventory.html', icon: '📊', key: 'nav_inventory', text: 'Inventory' },
  { href: 'stock-transfer.html', icon: '🔄', key: 'nav_stock_transfer', text: 'Stock Transfer' },
  { href: 'price-list.html', icon: '💰', key: 'nav_price_list', text: 'Price List' },
  { href: 'purchases.html', icon: '📥', key: 'nav_purchases', text: 'Purchases' },
  { href: 'receipts.html', icon: '🧾', key: 'nav_receipts', text: 'Receipts' },
  { href: 'reports.html', icon: '📈', key: 'nav_reports', text: 'Reports' },
  { href: 'suppliers.html', icon: '🏢', key: 'nav_suppliers', text: 'Suppliers' },
  { href: 'customers.html', icon: '👥', key: 'nav_customers', text: 'Customers' },
  { href: 'open-orders.html', icon: '📝', key: 'nav_open_orders', text: 'Open Orders' },
  { href: 'salesmen.html', icon: '🧑\u200D💼', key: 'nav_salesmen', text: 'Salesmen' },
  { href: 'expenses.html', icon: '📋', key: 'nav_expenses', text: 'Expenses' },
  { href: 'stores.html', icon: '🏢', key: 'nav_stores', text: 'Warehouses' },
  { href: 'admin.html', icon: '⚙️', key: 'nav_admin', text: 'Admin Panel' },
  { href: 'backup.html', icon: '💾', key: 'nav_backup', text: 'Backup' }
];

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Generate nav items, marking the current one active
  const navHtml = items.map(item => {
    const isActive = item.href === file;
    const baseClass = "flex items-center px-6 py-3 text-sm font-medium transition-all duration-200 border-l-4";
    const activeClass = "border-brand-blue bg-white/10 text-white";
    const inactiveClass = "border-transparent hover:bg-white/5 hover:pl-7 text-gray-300 hover:text-white";
    const finalClass = isActive ? `${baseClass} ${activeClass}` : `${baseClass} ${inactiveClass}`;
    
    return `        <a href="${item.href}" class="${finalClass}" data-i18n="${item.key}">${item.icon} ${item.text}</a>`;
  }).join('\n');

  const fullNavBlock = `      <nav class="flex-1 overflow-y-auto py-4">
${navHtml}
      </nav>`;

  const regex = /<nav[^>]*>[\s\S]*?<\/nav>/;
  if (regex.test(content)) {
    content = content.replace(regex, fullNavBlock);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Updated " + file);
  } else {
    console.log("No nav found in " + file);
  }
});
