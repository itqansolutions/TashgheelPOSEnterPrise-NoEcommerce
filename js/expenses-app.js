// expenses-app.js — Tashgheel POS Enterprise
// Requires: auth.js, translations.js

document.addEventListener('DOMContentLoaded', () => {
    // ── Auth Guard ────────────────────────────────────────────────
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = 'index.html'; return; }

    // ── User Display ──────────────────────────────────────────────
    const user = window.getCurrentUser ? window.getCurrentUser() : JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (user) {
        const el = document.getElementById('currentUserName');
        if (el) el.textContent = user.fullName || user.username;
    }

    // ── State ─────────────────────────────────────────────────────
    let storesMap = {};

    // ── Helper: get token ─────────────────────────────────────────
    function getToken() { return localStorage.getItem('token') || ''; }

    // Set default date to today
    const dateInput = document.getElementById('expense-date');
    if (dateInput) {
        dateInput.valueAsDate = new Date();
    }

    // ── Load Dropdowns ────────────────────────────────────────────
    async function loadStores() {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return;
            const stores = await res.json();
            const branchSel = document.getElementById('expense-branch');
            if (branchSel) {
                while (branchSel.options.length > 1) branchSel.remove(1);
                stores.forEach(s => {
                    storesMap[s.id] = s.name;
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.name;
                    branchSel.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Error loading stores:', err);
        }
    }

    async function loadSellers() {
        try {
            const res = await fetch('/api/salesmen', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return;
            const salesmen = await res.json();
            const sellerSel = document.getElementById('expense-seller');
            if (sellerSel) {
                while (sellerSel.options.length > 1) sellerSel.remove(1);
                salesmen.forEach(s => {
                    if (!s.name) return;
                    const opt = document.createElement('option');
                    opt.value = s.name;
                    opt.textContent = s.name;
                    sellerSel.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Error loading sellers:', err);
        }
    }

    // ── Load Expenses ─────────────────────────────────────────────
    async function loadExpenses() {
        const tbody = document.getElementById('expenses-body');
        if (!tbody) return;

        try {
            const res = await fetch('/api/expenses', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);">Error loading expenses</td></tr>`;
                return;
            }
            const expenses = await res.json();
            renderExpenses(expenses);
        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    }

    function renderExpenses(expenses) {
        const tbody = document.getElementById('expenses-body');
        const totalText = document.getElementById('totalExpenses');
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!tbody) return;

        if (!expenses || expenses.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-3);">${lang === 'ar' ? 'لا توجد مصاريف مسجلة' : 'No expenses recorded'}</td></tr>`;
            if (totalText) totalText.textContent = `Total: 0.00 EGP`;
            return;
        }

        let totalAmount = 0;
        tbody.innerHTML = expenses.map(e => {
            totalAmount += e.amount;
            const branchName = storesMap[e.branchId] || e.branchId || '-';
            const catLabel = lang === 'ar' ? getCategoryAr(e.category) : e.category;
            const methodLabel = getMethodLabel(e.method, lang);

            return `
                <tr>
                    <td style="font-size:0.8rem;font-weight:500;">${e.date}</td>
                    <td style="font-weight:600">${e.description}</td>
                    <td><span class="badge badge-secondary">${catLabel}</span></td>
                    <td>${branchName}</td>
                    <td>${e.seller || '-'}</td>
                    <td style="font-weight:600;color:var(--red);">${e.amount.toFixed(2)}</td>
                    <td><span class="badge badge-info">${methodLabel}</span></td>
                    <td>
                        <button class="action-btn delete-btn" onclick="deleteExpense('${e.id}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        if (totalText) {
            totalText.textContent = lang === 'ar'
                ? `الإجمالي: ${totalAmount.toFixed(2)} ج.م`
                : `Total: ${totalAmount.toFixed(2)} EGP`;
        }
    }

    function getCategoryAr(cat) {
        const cats = {
            rent: 'إيجار',
            salaries: 'رواتب',
            electricity: 'كهرباء',
            transportation: 'مواصلات',
            miscellaneous: 'متنوع'
        };
        return cats[cat] || cat;
    }

    function getMethodLabel(method, lang) {
        const labels = {
            en: { cash: 'Cash', card: 'Card', mobile: 'Mobile Wallet' },
            ar: { cash: 'نقدي', card: 'بطاقة دفع', mobile: 'محفظة موبايل' }
        };
        return labels[lang]?.[method] || method;
    }

    // ── Submit Form ───────────────────────────────────────────────
    const form = document.getElementById('expense-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const lang = localStorage.getItem('pos_language') || 'en';

            const date = document.getElementById('expense-date').value;
            const description = document.getElementById('expense-desc').value.trim();
            const category = document.getElementById('expense-category').value;
            const branchId = document.getElementById('expense-branch').value;
            const seller = document.getElementById('expense-seller').value || null;
            const amount = parseFloat(document.getElementById('expense-amount').value);
            const method = document.getElementById('expense-method').value;

            if (!date || !description || isNaN(amount) || amount <= 0 || !branchId) {
                showToast(lang === 'ar' ? 'يرجى ملء جميع الحقول الإلزامية بشكل صحيح' : 'Please fill all required fields correctly', 'error');
                return;
            }

            const body = { date, description, category, branchId, seller, amount, method };

            try {
                const res = await fetch('/api/expenses', {
                    method: 'POST',
                    headers: {
                        'x-auth-token': getToken(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                if (!res.ok) {
                    showToast(lang === 'ar' ? 'فشل إضافة المصروف' : 'Failed to add expense', 'error');
                    return;
                }

                showToast(lang === 'ar' ? 'تمت إضافة المصروف بنجاح' : 'Expense added successfully');
                document.getElementById('expense-desc').value = '';
                document.getElementById('expense-amount').value = '';
                document.getElementById('expense-method').value = 'cash';
                document.getElementById('expense-category').value = 'miscellaneous';
                document.getElementById('expense-seller').value = '';
                loadExpenses();
            } catch (err) {
                console.error(err);
                showToast('Connection error', 'error');
            }
        });
    }

    // ── Delete Expense ────────────────────────────────────────────
    window.deleteExpense = async function(id) {
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!confirm(lang === 'ar' ? 'هل أنت متأكد من حذف هذا المصروف؟' : 'Are you sure you want to delete this expense?')) return;

        try {
            const res = await fetch(`/api/expenses/${id}`, {
                method: 'DELETE',
                headers: { 'x-auth-token': getToken() }
            });

            if (!res.ok) {
                showToast('Failed to delete expense', 'error');
                return;
            }

            showToast(lang === 'ar' ? 'تم الحذف بنجاح' : 'Expense deleted successfully');
            loadExpenses();
        } catch (err) {
            console.error(err);
            showToast('Connection error', 'error');
        }
    };

    // ── Init ──────────────────────────────────────────────────────
    async function init() {
        await loadStores(); // load stores map first
        await loadSellers();
        await loadExpenses();
        if (window.applyTranslations) window.applyTranslations();
    }

    init();
});
