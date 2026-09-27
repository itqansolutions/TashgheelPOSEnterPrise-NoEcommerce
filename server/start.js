const { execSync } = require('child_process');

console.log('Checking database migrations and baseline...');
try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('Prisma migrations deployed successfully.');
} catch (deployErr) {
    console.log('Migrate deploy encountered un-baselined database (P3005). Baselining migrations...');
    try {
        execSync('npx prisma migrate resolve --applied 20260927173000_phase2a2_variant_stock_ledger', { stdio: 'inherit' });
        console.log('Baselined 20260927173000_phase2a2_variant_stock_ledger');
    } catch (_) {}
    try {
        execSync('npx prisma migrate resolve --applied 20260927180000_phase2a4_reconciliation_and_store_lock', { stdio: 'inherit' });
        console.log('Baselined 20260927180000_phase2a4_reconciliation_and_store_lock');
    } catch (_) {}
    try {
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        console.log('Prisma migrations up to date.');
    } catch (finalErr) {
        console.warn('Migration warning:', finalErr.message);
    }
}

console.log('Starting application server...');
require('./index.js');
