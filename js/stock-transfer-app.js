// Stock Transfer App — Tashgheel POS Enterprise
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
    let selectedItems = []; // [{ id, name, code, maxStock, qty }]
    let searchDebounce = null;
    let suggestionsList = [];

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

    // ── Load Stores ───────────────────────────────────────────────
    async function loadStores() {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return;
            const stores = await res.json();
            const fromSel = document.getElementById('fromStore');
            const toSel = document.getElementById('toStore');
            if (!fromSel || !toSel) return;

            // Clear existing options except default placeholder
            while (fromSel.options.length > 1) fromSel.remove(1);
            while (toSel.options.length > 1) toSel.remove(1);

            stores.forEach(s => {
                const opt1 = document.createElement('option');
                opt1.value = s.id;
                opt1.textContent = s.name;
                fromSel.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = s.id;
                opt2.textContent = s.name;
                toSel.appendChild(opt2);
            });
        } catch (err) {
            console.error('Error loading stores:', err);
        }
    }

    // ── Product Search Autocomplete ───────────────────────────────
    const searchInp = document.getElementById('productSearch');
    const suggDiv = document.getElementById('productSuggestions');
    const fromStoreSel = document.getElementById('fromStore');

    if (searchInp && suggDiv) {
        searchInp.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const query = searchInp.value.trim();
            if (!query) {
                suggDiv.style.display = 'none';
                return;
            }

            const fromStoreId = fromStoreSel.value;
            if (!fromStoreId) {
                const lang = localStorage.getItem('pos_language') || 'en';
                showToast(lang === 'ar' ? 'يرجى اختيار مخزن المصدر أولاً' : 'Please select source warehouse first', 'error');
                searchInp.value = '';
                return;
            }

            searchDebounce = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/price-list?storeId=${fromStoreId}&search=${encodeURIComponent(query)}`, {
                        headers: { 'x-auth-token': getToken() }
                    });
                    if (!res.ok) return;
                    suggestionsList = await res.json();
                    renderSuggestions(suggestionsList);
                } catch (err) {
                    console.error('Autocomplete error:', err);
                }
            }, 300);
        });

        // Close suggestions list on click outside
        document.addEventListener('click', (e) => {
            if (e.target !== searchInp && e.target !== suggDiv) {
                suggDiv.style.display = 'none';
            }
        });
    }

    function renderSuggestions(products) {
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!products.length) {
            suggDiv.innerHTML = `<div style="padding:10px 16px;font-size:0.85rem;color:var(--text-3)">${lang === 'ar' ? 'لا توجد نتائج' : 'No results found'}</div>`;
            suggDiv.style.display = 'block';
            return;
        }

        suggDiv.innerHTML = products.map(p => `
            <div class="sugg-item" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.2s;"
                 onclick="addItemToTransfer('${p.id}')"
                 onmouseover="this.style.background='var(--brand-gray-light)'"
                 onmouseout="this.style.background='#fff'">
                <div style="font-weight:600;font-size:0.88rem;">${p.name}</div>
                <div style="font-size:0.75rem;color:var(--text-3);display:flex;justify-between;align-items:center;">
                    <span>Barcode: ${p.barcode || '-'}</span>
                    <span style="font-weight:600;margin-left:auto;">Stock: ${p.stock}</span>
                </div>
            </div>
        `).join('');
        suggDiv.style.display = 'block';
    }

    window.addItemToTransfer = function(productId) {
        const prod = suggestionsList.find(p => p.id === productId);
        if (!prod) return;

        searchInp.value = '';
        suggDiv.style.display = 'none';

        // Check if already added
        const exists = selectedItems.find(item => item.id === productId);
        if (exists) {
            exists.qty += 1;
            renderTransferTable();
            return;
        }

        selectedItems.push({
            id: prod.id,
            name: prod.name,
            code: prod.barcode || '',
            maxStock: prod.stock || 0,
            qty: 1
        });

        renderTransferTable();
    };

    // ── Render Transfer Cart Table ────────────────────────────────
    function renderTransferTable() {
        const sect = document.getElementById('transfer-items-section');
        const tbody = document.getElementById('transfer-items-body');
        if (!sect || !tbody) return;

        if (selectedItems.length === 0) {
            sect.style.display = 'none';
            tbody.innerHTML = '';
            return;
        }

        sect.style.display = 'block';
        tbody.innerHTML = selectedItems.map((item, idx) => `
            <tr>
                <td>
                    <div style="font-weight:600">${item.name}</div>
                    <div style="font-size:0.72rem;color:var(--text-3)">${item.code || '-'}</div>
                </td>
                <td style="font-weight:600">${item.maxStock}</td>
                <td>
                    <input type="number" value="${item.qty}" min="1" max="${item.maxStock}"
                           style="width:80px;padding:6px;border:1px solid var(--border);border-radius:var(--r-md);font-weight:600"
                           onchange="updateItemQty(${idx}, this.value)">
                </td>
                <td>
                    <button class="action-btn delete-btn" onclick="removeItem(${idx})">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    window.updateItemQty = function(idx, val) {
        const qty = parseInt(val) || 1;
        selectedItems[idx].qty = qty;
    };

    window.removeItem = function(idx) {
        selectedItems.splice(idx, 1);
        renderTransferTable();
    };

    // ── Reset Form ────────────────────────────────────────────────
    function resetForm() {
        selectedItems = [];
        document.getElementById('transferNotes').value = '';
        document.getElementById('productSearch').value = '';
        renderTransferTable();
    }

    // ── Submit Stock Transfer ─────────────────────────────────────
    window.submitTransfer = async function() {
        const lang = localStorage.getItem('pos_language') || 'en';
        const fromStoreId = document.getElementById('fromStore').value;
        const toStoreId = document.getElementById('toStore').value;
        const notes = document.getElementById('transferNotes').value.trim();

        if (!fromStoreId || !toStoreId) {
            showToast(lang === 'ar' ? 'يرجى اختيار مخزن المصدر والوجهة' : 'Please select both source and destination warehouses', 'error');
            return;
        }

        if (fromStoreId === toStoreId) {
            showToast(lang === 'ar' ? 'يجب أن يكون مخزن المصدر والوجهة مختلفين' : 'Source and destination warehouses must be different', 'error');
            return;
        }

        if (selectedItems.length === 0) {
            showToast(lang === 'ar' ? 'يرجى إضافة صنف واحد على الأقل للتحويل' : 'Please add at least one item to transfer', 'error');
            return;
        }

        // Validate quantities vs available stock
        for (const item of selectedItems) {
            if (item.qty <= 0) {
                showToast(lang === 'ar' ? 'الكمية غير صالحة' : 'Invalid quantity', 'error');
                return;
            }
            if (item.qty > item.maxStock) {
                showToast(lang === 'ar' ? `الكمية المطلوبة لـ ${item.name} تتجاوز المخزون المتاح` : `Quantity for ${item.name} exceeds available stock`, 'error');
                return;
            }
        }

        const body = {
            fromStoreId,
            toStoreId,
            notes,
            items: selectedItems.map(item => ({
                productId: item.id,
                qty: item.qty
            }))
        };

        const btn = document.getElementById('submitTransferBtn');
        if (btn) btn.disabled = true;

        try {
            const res = await fetch('/api/stock-transfers', {
                method: 'POST',
                headers: {
                    'x-auth-token': getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                showToast(errData.msg || (lang === 'ar' ? 'فشل تحويل المخزون' : 'Failed to transfer stock'), 'error');
                if (btn) btn.disabled = false;
                return;
            }

            showToast(lang === 'ar' ? 'تم تحويل المخزون بنجاح' : 'Stock transferred successfully');
            resetForm();
            loadHistory();
        } catch (err) {
            console.error('Error submitting transfer:', err);
            showToast(lang === 'ar' ? 'خطأ في الاتصال' : 'Connection error', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    // ── Load History ──────────────────────────────────────────────
    window.loadHistory = async function() {
        const tbody = document.getElementById('history-body');
        if (!tbody) return;

        try {
            const res = await fetch('/api/stock-transfers', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--red);">Failed to load history</td></tr>`;
                return;
            }
            const data = await res.json();
            renderHistory(data);
        } catch (err) {
            console.error('Error loading history:', err);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // Helper: format date
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Resolve store name
    async function getStoreNamesMap() {
        try {
            const res = await fetch('/api/stores', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) return {};
            const stores = await res.json();
            const map = {};
            stores.forEach(s => { map[s.id] = s.name; });
            return map;
        } catch (err) {
            console.error(err);
            return {};
        }
    }

    async function renderHistory(transfers) {
        const tbody = document.getElementById('history-body');
        const lang = localStorage.getItem('pos_language') || 'en';
        if (!tbody) return;

        if (!transfers || transfers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-3);">${lang === 'ar' ? 'لا يوجد سجل تحويلات' : 'No transfers found'}</td></tr>`;
            return;
        }

        const storeMap = await getStoreNamesMap();

        tbody.innerHTML = transfers.map(t => {
            const fromName = storeMap[t.fromStoreId] || t.fromStoreId;
            const toName = storeMap[t.toStoreId] || t.toStoreId;
            const itemsCount = Array.isArray(t.items) ? t.items.length : 0;

            return `
                <tr>
                    <td style="font-size:0.8rem;color:var(--text-2);font-weight:500;">${formatDate(t.date)}</td>
                    <td style="font-weight:600">${fromName}</td>
                    <td style="font-weight:600">${toName}</td>
                    <td>
                        <span class="badge badge-info">${itemsCount} ${lang === 'ar' ? 'أصناف' : 'items'}</span>
                    </td>
                    <td>${t.transferredBy || '-'}</td>
                    <td style="font-size:0.8rem;color:var(--text-2);">${t.notes || '-'}</td>
                </tr>
            `;
        }).join('');
    }

    // Reset autocomplete if warehouse source changes
    if (fromStoreSel) {
        fromStoreSel.addEventListener('change', () => {
            selectedItems = [];
            renderTransferTable();
        });
    }

    // ── Init ──────────────────────────────────────────────────────
    loadStores();
    loadHistory();
    if (window.applyTranslations) window.applyTranslations();
});
