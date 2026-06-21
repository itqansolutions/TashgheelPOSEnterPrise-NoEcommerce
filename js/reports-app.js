// reports-app.js — Tashgheel POS Enterprise
// Requires: auth.js, translations.js

document.addEventListener('DOMContentLoaded', () => {
    // Auth Guard
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    // Set user info
    const user = window.getCurrentUser ? window.getCurrentUser() : JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (user) {
        const el = document.getElementById('currentUserName');
        if (el) el.textContent = user.fullName || user.username;
    }

    const lang = localStorage.getItem('pos_language') || 'en';
    const t = (en, ar) => lang === 'ar' ? ar : en;

    // Helper: get token
    function getToken() { return localStorage.getItem('token') || ''; }

    // Set default dates to today
    const dateInputs = [
        'sales-from', 'sales-to',
        'discounts-from', 'discounts-to',
        'returns-from', 'returns-to',
        'inv-adj-from', 'inv-adj-to',
        'purchases-from', 'purchases-to'
    ];
    dateInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.valueAsDate = new Date();
    });

    // State
    let stores = [];
    let suppliers = [];
    let activeTab = 'sales';

    // ── Switch Tabs ───────────────────────────────────────────────
    window.switchReportTab = function(tabId) {
        activeTab = tabId;

        // Toggle button classes
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.getElementById(`tab-${tabId}`);
        if (activeBtn) activeBtn.classList.add('active');

        // Toggle panel display
        document.querySelectorAll('.report-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        const activePanel = document.getElementById(`panel-${tabId}`);
        if (activePanel) activePanel.classList.add('active');

        // Run query automatically if filterless
        if (tabId === 'ar-aging') {
            runArAgingReport();
        } else if (tabId === 'supplier-balances') {
            runSupplierBalancesReport();
        } else if (tabId === 'customer-balances') {
            runCustomerBalancesReport();
        } else if (tabId === 'sales') {
            runSalesReport();
        } else if (tabId === 'discounts') {
            runDiscountsReport();
        } else if (tabId === 'returns') {
            runReturnsReport();
        } else if (tabId === 'inv-adj') {
            runInvAdjReport();
        } else if (tabId === 'purchases') {
            runPurchasesReport();
        }
    };

    // ── Load Filters ──────────────────────────────────────────────
    async function loadFilterOptions() {
        try {
            // Load stores
            const storeRes = await fetch('/api/stores', { headers: { 'x-auth-token': getToken() } });
            if (storeRes.ok) {
                stores = await storeRes.json();
                const dSelect = document.getElementById('discounts-store');
                const iSelect = document.getElementById('inv-adj-store');
                [dSelect, iSelect].forEach(sel => {
                    if (!sel) return;
                    while (sel.options.length > 1) sel.remove(1);
                    stores.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.name;
                        sel.appendChild(opt);
                    });
                });
            }

            // Load suppliers
            const supRes = await fetch('/api/suppliers', { headers: { 'x-auth-token': getToken() } });
            if (supRes.ok) {
                suppliers = await supRes.json();
                const pSelect = document.getElementById('purchases-supplier');
                if (pSelect) {
                    while (pSelect.options.length > 1) pSelect.remove(1);
                    suppliers.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.name;
                        pSelect.appendChild(opt);
                    });
                }
            }
        } catch (err) {
            console.error('Error loading filters:', err);
        }
    }

    // ── TAB 1: Sales Report ───────────────────────────────────────
    window.runSalesReport = async function() {
        const from = document.getElementById('sales-from').value;
        const to = document.getElementById('sales-to').value;
        const tbody = document.getElementById('sales-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            // Load all products to compute cost & profit
            const prodRes = await fetch('/api/products', { headers: { 'x-auth-token': getToken() } });
            const products = prodRes.ok ? await prodRes.json() : [];
            const productMap = {};
            products.forEach(p => productMap[p.barcode] = p);

            // Fetch sales
            const salesRes = await fetch('/api/sales', { headers: { 'x-auth-token': getToken() } });
            if (!salesRes.ok) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--red);">Failed to load sales</td></tr>`;
                return;
            }
            const allSales = await salesRes.json();

            // Filter sales by date range
            const fromDate = from ? new Date(from) : null;
            const toDate = to ? new Date(to) : null;
            if (toDate) toDate.setHours(23, 59, 59, 999);

            const filtered = allSales.filter(s => {
                const d = new Date(s.date);
                return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
            });

            // Calculate overall metrics
            let totalSalesAmount = 0;
            let totalProfitAmount = 0;
            let totalExpensesAmount = 0;

            // Fetch expenses
            const expRes = await fetch('/api/expenses', { headers: { 'x-auth-token': getToken() } });
            if (expRes.ok) {
                const allExpenses = await expRes.json();
                allExpenses.forEach(e => {
                    const d = new Date(e.date);
                    if ((!fromDate || d >= fromDate) && (!toDate || d <= toDate)) {
                        totalExpensesAmount += e.amount;
                    }
                });
            }

            tbody.innerHTML = '';
            filtered.forEach(s => {
                let saleDiscount = 0;
                let saleGross = 0;
                const items = Array.isArray(s.items) ? s.items : [];

                items.forEach(i => {
                    const disc = i.discount?.type === 'percent'
                        ? i.price * i.discount.value / 100 * i.qty
                        : (i.discount?.value || 0) * i.qty;
                    saleDiscount += disc;
                    saleGross += i.qty * i.price;
                });

                const netSale = saleGross - saleDiscount;
                totalSalesAmount += netSale;

                // Profit calculation
                let costSum = 0;
                items.forEach(i => {
                    const c = productMap[i.code]?.cost || i.cost || 0;
                    costSum += i.qty * c;
                });
                const profit = netSale - costSum;
                totalProfitAmount += profit;

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(s.date).toLocaleDateString()}</td>
                    <td class="font-bold">${s.receiptId}</td>
                    <td><span class="badge badge-success">${s.orderType || 'instore'}</span></td>
                    <td class="font-bold">${netSale.toFixed(2)}</td>
                    <td class="text-green-600">${profit.toFixed(2)}</td>
                `;
                tbody.appendChild(tr);
            });

            // Set metric cards
            document.getElementById('totalSales').textContent = `${totalSalesAmount.toFixed(2)} EGP`;
            document.getElementById('totalProfit').textContent = `${totalProfitAmount.toFixed(2)} EGP`;
            document.getElementById('totalExpenses').textContent = `${totalExpensesAmount.toFixed(2)} EGP`;
            document.getElementById('netProfit').textContent = `${(totalProfitAmount - totalExpensesAmount).toFixed(2)} EGP`;

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-3);">${t('No sales found', 'لا توجد مبيعات')}</td></tr>`;
            }

        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 2: AR Aging ───────────────────────────────────────────
    window.runArAgingReport = async function() {
        const tbody = document.getElementById('ar-aging-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const res = await fetch('/api/reports/ar-aging', { headers: { 'x-auth-token': getToken() } });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                return;
            }
            const data = await res.json();

            // Set metric cards
            document.getElementById('aging-0-10').textContent = `${data.totals['0-10'].toFixed(2)} EGP`;
            document.getElementById('aging-11-30').textContent = `${data.totals['11-30'].toFixed(2)} EGP`;
            document.getElementById('aging-31-60').textContent = `${data.totals['31-60'].toFixed(2)} EGP`;
            document.getElementById('aging-60').textContent = `${data.totals['60+'].toFixed(2)} EGP`;

            tbody.innerHTML = '';
            let count = 0;
            for (const category in data.buckets) {
                data.buckets[category].forEach(c => {
                    count++;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight:600">${c.customer}</td>
                        <td>${c.phone || '-'}</td>
                        <td style="font-weight:700">${c.amount.toFixed(2)}</td>
                        <td><span class="badge badge-warning">${category} ${lang === 'ar' ? 'أيام' : 'days'}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            if (count === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-3);">${t('No unpaid balances found', 'لا توجد ديون ذمم مدينة')}</td></tr>`;
            }
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 3: Discounts Report ───────────────────────────────────
    window.runDiscountsReport = async function() {
        const from = document.getElementById('discounts-from').value;
        const to = document.getElementById('discounts-to').value;
        const storeId = document.getElementById('discounts-store').value;
        const tbody = document.getElementById('discounts-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (storeId) params.append('storeId', storeId);

            const res = await fetch(`/api/reports/discounts?${params.toString()}`, {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                return;
            }
            const data = await res.json();

            tbody.innerHTML = '';
            const rows = Array.isArray(data.rows) ? data.rows : [];
            rows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600">${r.cashier}</td>
                    <td>${r.invoiceCount}</td>
                    <td style="font-weight:700;color:var(--red);">${r.totalDiscount.toFixed(2)} EGP</td>
                `;
                tbody.appendChild(tr);
            });

            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-3);">${t('No discounts recorded', 'لم يتم منح خصومات في هذه الفترة')}</td></tr>`;
            }
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 4: Returns Report ─────────────────────────────────────
    window.runReturnsReport = async function() {
        const from = document.getElementById('returns-from').value;
        const to = document.getElementById('returns-to').value;
        const productCode = document.getElementById('returns-code').value.trim();
        const tbody = document.getElementById('returns-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (productCode) params.append('productCode', productCode);

            const res = await fetch(`/api/reports/returns?${params.toString()}`, {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                return;
            }
            const data = await res.json();

            tbody.innerHTML = '';
            const rows = Array.isArray(data.rows) ? data.rows : [];
            rows.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(r.date).toLocaleDateString()}</td>
                    <td class="font-bold">${r.receiptId}</td>
                    <td>${r.cashier}</td>
                    <td style="font-weight:600">${r.itemName}</td>
                    <td>${r.qty}</td>
                    <td style="font-weight:700;color:var(--red);">${r.refundAmount.toFixed(2)} EGP</td>
                    <td style="font-size:0.8rem;color:var(--text-2);">${r.reason || '-'}</td>
                `;
                tbody.appendChild(tr);
            });

            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3);">${t('No returns found', 'لا توجد مرتجعات في هذه الفترة')}</td></tr>`;
            }
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 5: Inventory Adjustments ──────────────────────────────
    window.runInvAdjReport = async function() {
        const from = document.getElementById('inv-adj-from').value;
        const to = document.getElementById('inv-adj-to').value;
        const storeId = document.getElementById('inv-adj-store').value;
        const tbody = document.getElementById('inv-adj-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (storeId) params.append('storeId', storeId);

            const res = await fetch(`/api/reports/inventory-adjustments?${params.toString()}`, {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                return;
            }
            const data = await res.json();

            tbody.innerHTML = '';
            const adjs = Array.isArray(data.adjustments) ? data.adjustments : [];
            adjs.forEach(adj => {
                const items = Array.isArray(adj.items) ? adj.items : [];
                const detailHtml = items.map(i => {
                    const diff = i.difference || 0;
                    const diffColor = diff > 0 ? 'color:var(--green)' : 'color:var(--red)';
                    const diffSign = diff > 0 ? `+${diff}` : diff;
                    return `<div>• ${i.productName}: <span style="${diffColor};font-weight:600">${diffSign}</span> (Reason: ${i.reason || '-'})</div>`;
                }).join('');

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(adj.date).toLocaleDateString()} ${new Date(adj.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style="font-weight:600">${adj.adjustedBy}</td>
                    <td style="font-size:0.8rem">${detailHtml || '-'}</td>
                `;
                tbody.appendChild(tr);
            });

            if (adjs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-3);">${t('No adjustments recorded', 'لا توجد تسويات مخزون')}</td></tr>`;
            }
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 6: Supplier Balances ──────────────────────────────────
    window.runSupplierBalancesReport = async function() {
        const tbody = document.getElementById('supplier-balances-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const res = await fetch('/api/reports/supplier-balances', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                return;
            }
            const data = await res.json();

            document.getElementById('supplierTotalOwed').textContent = lang === 'ar'
                ? `إجمالي المستحق: ${data.totalOwed.toFixed(2)} ج.م`
                : `Total Owed: ${data.totalOwed.toFixed(2)} EGP`;

            tbody.innerHTML = '';
            const sups = Array.isArray(data.suppliers) ? data.suppliers : [];
            sups.forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600">${s.name}</td>
                    <td>${s.phone || '-'}</td>
                    <td style="font-weight:700;color:var(--red)">${s.balance.toFixed(2)} EGP</td>
                `;
                tbody.appendChild(tr);
            });

            if (sups.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-3);">${t('No outstanding supplier debt', 'لا توجد ديون مستحقة للموردين')}</td></tr>`;
            }
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 7: Customer Balances ──────────────────────────────────
    window.runCustomerBalancesReport = async function() {
        const tbody = document.getElementById('customer-balances-table-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const res = await fetch('/api/reports/customer-balances', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                return;
            }
            const data = await res.json();

            document.getElementById('customerTotalOwed').textContent = lang === 'ar'
                ? `صافي الديون المستحقة: ${data.totalOwed.toFixed(2)} ج.م`
                : `Total Outstanding: ${data.totalOwed.toFixed(2)} EGP`;

            tbody.innerHTML = '';
            const custs = Array.isArray(data.customers) ? data.customers : [];
            custs.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600">${c.name}</td>
                    <td>${c.phone || '-'}</td>
                    <td style="font-weight:700;color:var(--brand-blue)">${c.balance.toFixed(2)} EGP</td>
                `;
                tbody.appendChild(tr);
            });

            if (custs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-3);">${t('No customer outstanding balances', 'لا توجد ذمم مستحقة على العملاء')}</td></tr>`;
            }
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── TAB 8: Purchases Report ───────────────────────────────────
    window.runPurchasesReport = async function() {
        const from = document.getElementById('purchases-from').value;
        const to = document.getElementById('purchases-to').value;
        const supplierId = document.getElementById('purchases-supplier').value;
        const tbody = document.getElementById('purchases-table-body');
        const breakBody = document.getElementById('purchases-breakdown-body');
        if (!tbody || !breakBody) return;

        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;
        breakBody.innerHTML = `<tr><td colspan="3" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (supplierId) params.append('supplierId', supplierId);

            const res = await fetch(`/api/reports/purchases-report?${params.toString()}`, {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);">Failed to load report</td></tr>`;
                breakBody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Failed to load breakdown</td></tr>`;
                return;
            }
            const data = await res.json();

            tbody.innerHTML = '';
            const purchases = Array.isArray(data.purchases) ? data.purchases : [];
            purchases.forEach(p => {
                const itemsCount = Array.isArray(p.items) ? p.items.length : 0;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${new Date(p.date).toLocaleDateString()}</td>
                    <td class="font-bold">${p.receiptId}</td>
                    <td style="font-weight:600">${p.supplier ? p.supplier.name : '-'}</td>
                    <td style="font-weight:700">${p.total.toFixed(2)} EGP</td>
                    <td style="font-weight:600;color:var(--green)">${(p.cashPaid || 0).toFixed(2)} EGP</td>
                    <td>${itemsCount}</td>
                `;
                tbody.appendChild(tr);
            });

            breakBody.innerHTML = '';
            const breakdown = Array.isArray(data.supplierBreakdown) ? data.supplierBreakdown : [];
            breakdown.forEach(b => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600">${b.supplierName}</td>
                    <td>${b.count}</td>
                    <td style="font-weight:700">${b.total.toFixed(2)} EGP</td>
                `;
                breakBody.appendChild(tr);
            });

            if (purchases.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-3);">${t('No purchases found', 'لا توجد مشتريات في هذه الفترة')}</td></tr>`;
            }
            if (breakdown.length === 0) {
                breakBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-3);">${t('No breakdown available', 'لا توجد تفاصيل للموردين')}</td></tr>`;
            }

        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
            breakBody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── Init ──────────────────────────────────────────────────────
    async function init() {
        await loadFilterOptions();
        runSalesReport(); // run default tab report
        if (window.applyTranslations) window.applyTranslations();
    }

    init();
});
