// Price List App — Tashgheel POS Enterprise
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
    let searchDebounceTimer = null;
    let currentEditId = null;

    // ── Helper: get token ─────────────────────────────────────────
    function getToken() { return localStorage.getItem('token') || ''; }

    // ── Toast ─────────────────────────────────────────────────────
    function showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toast-msg');
        if (!toast) return;
        toast.style.background = type === 'error' ? '#ef4444' : '#10b981';
        toast.style.boxShadow = type === 'error'
            ? '0 8px 24px rgba(239,68,68,0.35)'
            : '0 8px 24px rgba(16,185,129,0.35)';
        toastMsg.textContent = msg;
        toast.style.display = 'flex';
        setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }

    // ── Load Stores Dropdown ──────────────────────────────────────
    async function loadStores() {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return;
            const stores = await res.json();
            const sel = document.getElementById('storeFilter');
            if (!sel) return;
            // Keep the "All Stores" option, remove old dynamic ones
            while (sel.options.length > 1) sel.remove(1);
            if (Array.isArray(stores)) {
                stores.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s._id || s.id || s.name;
                    opt.textContent = s.name;
                    sel.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Error loading stores:', err);
        }
    }

    // ── Fetch & Render Price List ─────────────────────────────────
    window.fetchPriceList = async function() {
        const storeId = document.getElementById('storeFilter')?.value || '';
        const search  = document.getElementById('searchInput')?.value?.trim() || '';
        const tbody   = document.getElementById('price-list-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3);">
            <i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>Loading...</td></tr>`;

        try {
            const params = new URLSearchParams();
            if (storeId) params.append('storeId', storeId);
            if (search)  params.append('search', search);

            const res = await fetch(`/api/price-list?${params.toString()}`, {
                headers: { 'x-auth-token': getToken(), 'Content-Type': 'application/json' }
            });

            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--red);">
                    <i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i>Error loading data</td></tr>`;
                return;
            }

            const products = await res.json();
            renderPriceList(Array.isArray(products) ? products : (products.data || []));
        } catch (err) {
            console.error('Error fetching price list:', err);
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--red);">
                <i class="fas fa-wifi" style="margin-right:8px;"></i>Connection error</td></tr>`;
        }
    };

    // ── Render Table Rows ─────────────────────────────────────────
    function renderPriceList(products) {
        const tbody = document.getElementById('price-list-body');
        const lang  = localStorage.getItem('pos_language') || 'en';
        if (!tbody) return;

        if (!products.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3);">
                <i class="fas fa-box-open" style="margin-right:8px;"></i>
                ${lang === 'ar' ? 'لا توجد منتجات' : 'No products found'}</td></tr>`;
            return;
        }

        tbody.innerHTML = products.map(p => {
            const id        = p._id || p.id;
            const isLowStock = p.minStock > 0 && p.stock <= p.minStock;
            const lowBadge  = isLowStock
                ? `<span class="badge badge-danger" style="margin-left:6px;" data-i18n="low_stock">${lang === 'ar' ? 'مخزون منخفض' : 'Low Stock'}</span>`
                : '';
            const stockDisplay = p.unlimited
                ? `<span class="badge badge-info">∞</span>`
                : `<span style="font-weight:600;color:${isLowStock ? 'var(--red)' : 'var(--text-1)'}">${p.stock ?? 0}</span>${lowBadge}`;

            return `
            <tr id="row-${id}">
                <td>
                    <div style="font-weight:600;color:var(--text-1)">${p.name || '-'}</div>
                    ${p.code ? `<div style="font-size:0.72rem;color:var(--text-3)">${p.code}</div>` : ''}
                </td>
                <td style="font-family:monospace;font-size:0.82rem">${p.barcode || '-'}</td>
                <td>
                    <span class="badge badge-secondary">${p.category || '-'}</span>
                </td>
                <td>${stockDisplay}</td>
                <td style="font-weight:500">${formatCurrency(p.cost)}</td>
                <td id="price-cell-${id}">
                    <span style="font-weight:700;color:var(--blue-dark);font-size:0.95rem">${formatCurrency(p.price)}</span>
                </td>
                <td>
                    <button class="action-btn edit-btn" onclick="startEdit('${id}', ${p.price})" title="${lang === 'ar' ? 'تعديل السعر' : 'Edit Price'}">
                        <i class="fas fa-pen"></i> ${lang === 'ar' ? 'تعديل' : 'Edit'}
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── Inline Edit: Start ────────────────────────────────────────
    window.startEdit = function(id, currentPrice) {
        // Cancel any previous edit
        if (currentEditId && currentEditId !== id) {
            cancelEdit(currentEditId);
        }
        currentEditId = id;
        const lang = localStorage.getItem('pos_language') || 'en';
        const cell = document.getElementById(`price-cell-${id}`);
        if (!cell) return;

        cell.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <input type="number" id="price-input-${id}" value="${currentPrice}"
                    step="0.01" min="0"
                    style="width:100px;padding:6px 10px;border:1.5px solid var(--blue);
                           border-radius:var(--r-md);font-size:0.85rem;font-weight:600;
                           box-shadow:0 0 0 3px rgba(37,99,235,0.12);outline:none;"
                    onkeydown="if(event.key==='Enter') savePrice('${id}'); if(event.key==='Escape') cancelEdit('${id}')">
                <button class="btn btn-primary" style="padding:5px 12px;font-size:0.78rem"
                    onclick="savePrice('${id}')">
                    <i class="fas fa-check"></i> ${lang === 'ar' ? 'حفظ' : 'Save'}
                </button>
                <button class="btn btn-secondary" style="padding:5px 10px;font-size:0.78rem"
                    onclick="cancelEdit('${id}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>`;

        // Focus on input
        setTimeout(() => {
            const inp = document.getElementById(`price-input-${id}`);
            if (inp) inp.focus();
        }, 50);
    };

    // ── Inline Edit: Cancel ───────────────────────────────────────
    window.cancelEdit = function(id) {
        currentEditId = null;
        // Re-fetch to restore the row
        fetchPriceList();
    };

    // ── Inline Edit: Save ─────────────────────────────────────────
    window.savePrice = async function(id) {
        const lang     = localStorage.getItem('pos_language') || 'en';
        const input    = document.getElementById(`price-input-${id}`);
        if (!input) return;
        const newPrice = parseFloat(input.value);

        if (isNaN(newPrice) || newPrice < 0) {
            showToast(lang === 'ar' ? 'سعر غير صالح' : 'Invalid price', 'error');
            return;
        }

        // Disable input while saving
        input.disabled = true;

        try {
            const res = await fetch(`/api/price-list/${id}`, {
                method: 'PUT',
                headers: {
                    'x-auth-token': getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ price: newPrice })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                showToast(data.msg || (lang === 'ar' ? 'خطأ في الحفظ' : 'Error saving price'), 'error');
                input.disabled = false;
                return;
            }

            currentEditId = null;
            showToast(lang === 'ar' ? 'تم تحديث السعر بنجاح' : 'Price updated successfully');
            fetchPriceList();
        } catch (err) {
            console.error('Error saving price:', err);
            showToast(lang === 'ar' ? 'خطأ في الاتصال' : 'Connection error', 'error');
            input.disabled = false;
        }
    };

    // ── Currency Formatter ────────────────────────────────────────
    function formatCurrency(val) {
        if (val === null || val === undefined || val === '') return '-';
        return parseFloat(val).toFixed(2);
    }

    // ── Events ────────────────────────────────────────────────────
    const storeFilter  = document.getElementById('storeFilter');
    const searchInput  = document.getElementById('searchInput');

    if (storeFilter) {
        storeFilter.addEventListener('change', () => fetchPriceList());
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => fetchPriceList(), 300);
        });
    }

    // ── Init ──────────────────────────────────────────────────────
    loadStores();
    fetchPriceList();
    if (window.applyTranslations) window.applyTranslations();
});
