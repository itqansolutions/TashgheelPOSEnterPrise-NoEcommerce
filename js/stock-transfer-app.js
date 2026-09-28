// Stock Transfer App — Tashgheel POS Enterprise
// PHASE 2A.6: SSOT Variant Selection & Live Availability Guard
// Requires: auth.js, translations.js, store-context.js

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
    let selectedItems = []; // [{ id, name, code, variantId, variantName, maxStock, qty }]
    let searchDebounce = null;
    let suggestionsList = [];
    let pendingProduct = null;
    let allStores = [];

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
        setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }

    // ── Load Stores ───────────────────────────────────────────────
    async function loadStores() {
        try {
            allStores = window.StoreContext ? await window.StoreContext.loadStores() : [];
            if (allStores.length === 0) {
                const res = await fetch('/api/stores', {
                    headers: { 'x-auth-token': getToken() }
                });
                if (res.ok) allStores = await res.json();
            }

            const fromSel = document.getElementById('fromStore');
            const toSel = document.getElementById('toStore');
            if (!fromSel || !toSel) return;

            while (fromSel.options.length > 1) fromSel.remove(1);
            while (toSel.options.length > 1) toSel.remove(1);

            allStores.forEach(s => {
                const opt1 = document.createElement('option');
                opt1.value = s.id;
                opt1.textContent = s.isReconciling ? `🔒 ${s.name} (قيد الجرد)` : s.name;
                fromSel.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = s.id;
                opt2.textContent = s.isReconciling ? `🔒 ${s.name} (قيد الجرد)` : s.name;
                toSel.appendChild(opt2);
            });

            // Restore from global store context
            const activeStoreId = window.StoreContext ? window.StoreContext.getActiveStoreId() : localStorage.getItem('pos_selected_store');
            if (activeStoreId && allStores.some(s => String(s.id) === String(activeStoreId))) {
                fromSel.value = activeStoreId;
                updateStoreBadges();
            }
        } catch (err) {
            console.error('Error loading stores:', err);
        }
    }

    function updateStoreBadges() {
        const fromSel = document.getElementById('fromStore');
        const toSel = document.getElementById('toStore');
        const fromBadge = document.getElementById('from-store-status');
        const toBadge = document.getElementById('to-store-status');

        if (fromSel && fromBadge && window.StoreContext) {
            const s = allStores.find(st => String(st.id) === String(fromSel.value));
            window.StoreContext.renderStatusBadge(fromBadge, s);
        }
        if (toSel && toBadge && window.StoreContext) {
            const s = allStores.find(st => String(st.id) === String(toSel.value));
            window.StoreContext.renderStatusBadge(toBadge, s);
        }
    }

    document.getElementById('fromStore')?.addEventListener('change', (e) => {
        if (window.StoreContext) window.StoreContext.setActiveStoreId(e.target.value, 'transfer');
        updateStoreBadges();
        // Clear items since source store changed
        if (selectedItems.length > 0) {
            selectedItems = [];
            renderTransferTable();
            showToast('تمت إعادة تعيين بنود التحويل لتغيير مخزن المصدر', 'info');
        }
    });

    document.getElementById('toStore')?.addEventListener('change', () => {
        updateStoreBadges();
    });

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

        suggDiv.innerHTML = products.map(p => {
            const hasVar = p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0;
            const badge = hasVar ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 font-bold ml-1">🏷️ ${p.variants.length} Variants</span>` : '';
            return `
                <div class="sugg-item" style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.2s;"
                     onclick="handleProductSuggestionClick('${p.id}')"
                     onmouseover="this.style.background='var(--brand-gray-light)'"
                     onmouseout="this.style.background='#fff'">
                    <div style="font-weight:600;font-size:0.88rem;">${p.name} ${badge}</div>
                    <div style="font-size:0.75rem;color:var(--text-3);display:flex;justify-content:space-between;align-items:center;">
                        <span>Barcode: ${p.barcode || '-'}</span>
                        <span style="font-weight:600;margin-left:auto;color:#1e40af;">Available in Source: ${p.stock ?? 0}</span>
                    </div>
                </div>
            `;
        }).join('');
        suggDiv.style.display = 'block';
    }

    window.handleProductSuggestionClick = function(productId) {
        const prod = suggestionsList.find(p => p.id === productId);
        if (!prod) return;

        searchInp.value = '';
        suggDiv.style.display = 'none';

        const hasVar = prod.hasVariants && Array.isArray(prod.variants) && prod.variants.length > 0;

        if (hasVar) {
            // Show Variant Picker container
            pendingProduct = prod;
            const container = document.getElementById('variant-selection-container');
            const titleEl = document.getElementById('selected-product-title');
            const selectEl = document.getElementById('variantSelect');
            const badgeEl = document.getElementById('source-avail-badge');

            if (titleEl) titleEl.textContent = prod.name;
            if (selectEl) {
                selectEl.innerHTML = prod.variants.map(v => {
                    const vStock = Number(v.stock || 0);
                    return `<option value="${v.id}" data-stock="${vStock}">${v.name || v.id} (Available: ${vStock})</option>`;
                }).join('');

                const firstOpt = selectEl.options[0];
                if (badgeEl && firstOpt) badgeEl.textContent = firstOpt.dataset.stock || '0';

                selectEl.onchange = () => {
                    const opt = selectEl.options[selectEl.selectedIndex];
                    if (badgeEl && opt) badgeEl.textContent = opt.dataset.stock || '0';
                };
            }

            if (container) container.style.display = 'block';
        } else {
            // Standard Product
            addTransferItem({
                id: prod.id,
                name: prod.name,
                code: prod.barcode || '',
                variantId: null,
                variantName: null,
                maxStock: Number(prod.stock || 0),
                qty: 1
            });
        }
    };

    window.confirmAddVariantItem = function() {
        if (!pendingProduct) return;
        const selectEl = document.getElementById('variantSelect');
        if (!selectEl) return;

        const opt = selectEl.options[selectEl.selectedIndex];
        if (!opt) return;

        const variantId = opt.value;
        const maxStock = Number(opt.dataset.stock || 0);
        const variantObj = pendingProduct.variants.find(v => String(v.id) === String(variantId));
        const variantName = variantObj ? (variantObj.name || variantObj.id) : opt.textContent;

        addTransferItem({
            id: pendingProduct.id,
            name: pendingProduct.name,
            code: variantObj?.barcode || pendingProduct.barcode || '',
            variantId,
            variantName,
            maxStock,
            qty: 1
        });

        // Hide picker
        const container = document.getElementById('variant-selection-container');
        if (container) container.style.display = 'none';
        pendingProduct = null;
    };

    function addTransferItem(itemData) {
        // Check if already in list
        const exists = selectedItems.find(item => item.id === itemData.id && item.variantId === itemData.variantId);
        if (exists) {
            if (exists.qty < exists.maxStock) {
                exists.qty += 1;
            } else {
                showToast(`تم الوصول للحد الأقصى للمخزون المتاح (${exists.maxStock})`, 'error');
            }
            renderTransferTable();
            return;
        }

        if (itemData.maxStock <= 0) {
            showToast('تنبيه: الرصيد المتاح في مخزن المصدر هو 0', 'error');
        }

        selectedItems.push(itemData);
        renderTransferTable();
    }

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
        tbody.innerHTML = selectedItems.map((item, idx) => {
            const isOverStock = item.qty > item.maxStock;
            const inputBorder = isOverStock ? 'border-color:#ef4444;background:#fef2f2;' : '';
            const variantDisplay = item.variantId
                ? `<span class="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800">🏷️ ${item.variantName}</span>`
                : `<span class="text-xs text-gray-400 font-mono">(Standard)</span>`;

            return `
                <tr class="${isOverStock ? 'bg-red-50/50' : ''}">
                    <td>
                        <div style="font-weight:600">${item.name}</div>
                        <div style="font-size:0.72rem;color:var(--text-3)">${item.code || '-'}</div>
                    </td>
                    <td>${variantDisplay}</td>
                    <td style="font-weight:bold;font-family:monospace;font-size:0.95rem;color:#1e40af;">${item.maxStock}</td>
                    <td>
                        <input type="number" value="${item.qty}" min="1" max="${item.maxStock}"
                               style="width:85px;padding:6px;border:1.5px solid var(--border);border-radius:var(--r-md);font-weight:bold;text-align:center;${inputBorder}"
                               onchange="updateItemQty(${idx}, this.value)">
                        ${isOverStock ? '<span class="block text-[10px] text-red-600 font-bold mt-1">يتجاوز المتاح!</span>' : ''}
                    </td>
                    <td>
                        <button class="action-btn delete-btn" onclick="removeItem(${idx})" title="حذف">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.updateItemQty = function(idx, val) {
        const qty = parseInt(val) || 1;
        selectedItems[idx].qty = qty;
        renderTransferTable();
    };

    window.removeItem = function(idx) {
        selectedItems.splice(idx, 1);
        renderTransferTable();
    };

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

        // Check if either store is locked for reconciliation
        const fromStore = allStores.find(s => String(s.id) === String(fromStoreId));
        const toStore = allStores.find(s => String(s.id) === String(toStoreId));

        if (fromStore && fromStore.isReconciling) {
            showToast(`⚠️ مخزن المصدر [${fromStore.name}] مغلق حالياً لإجراء الجرد الافتتاحي`, 'error');
            return;
        }
        if (toStore && toStore.isReconciling) {
            showToast(`⚠️ مخزن الوجهة [${toStore.name}] مغلق حالياً لإجراء الجرد الافتتاحي`, 'error');
            return;
        }

        if (selectedItems.length === 0) {
            showToast(lang === 'ar' ? 'يرجى إضافة صنف واحد على الأقل للتحويل' : 'Please add at least one item to transfer', 'error');
            return;
        }

        // Validate quantities vs available stock (Client-side UX check)
        for (const item of selectedItems) {
            if (item.qty <= 0) {
                showToast(lang === 'ar' ? 'الكمية غير صالحة' : 'Invalid quantity', 'error');
                return;
            }
            if (item.qty > item.maxStock) {
                showToast(lang === 'ar' ? `الكمية المطلوبة لـ [${item.name}] تتجاوز الرصيد المتاح (${item.maxStock})` : `Quantity for ${item.name} exceeds available stock (${item.maxStock})`, 'error');
                return;
            }
        }

        const body = {
            fromStoreId,
            toStoreId,
            items: selectedItems.map(item => ({
                productId: item.id,
                variantId: item.variantId || null,
                qty: item.qty
            })),
            notes: notes || undefined
        };

        const submitBtn = document.getElementById('submitTransferBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Processing...';
        }

        try {
            const res = await fetch('/api/stock-transfers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': getToken()
                },
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (!res.ok) {
                if (res.status === 423 || data.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
                    showToast(`🔒 الفرع مغلق للجرد: ${data.msg || 'لا يمكن إجراء التحويل'}`, 'error');
                } else {
                    showToast(data.msg || 'Failed to complete transfer', 'error');
                }
                return;
            }

            showToast(lang === 'ar' ? `✅ تم التحويل بنجاح برقم: ${data.transferRef || ''}` : `✅ Transfer created: ${data.transferRef || ''}`, 'success');

            // Reset state
            selectedItems = [];
            document.getElementById('transferNotes').value = '';
            document.getElementById('productSearch').value = '';
            renderTransferTable();
            loadHistory();
        } catch (err) {
            console.error('Submit transfer error:', err);
            showToast('Connection error', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Transfer';
            }
        }
    };

    // ── Load History ──────────────────────────────────────────────
    window.loadHistory = async function() {
        const tbody = document.getElementById('history-body');
        if (!tbody) return;

        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3);"><i class="fas fa-spinner fa-spin mr-1"></i> Loading...</td></tr>`;

        try {
            const res = await fetch('/api/stock-transfers', {
                headers: { 'x-auth-token': getToken() }
            });
            if (!res.ok) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);">Failed to load history</td></tr>`;
                return;
            }

            const transfers = await res.json();
            if (!transfers.length) {
                const lang = localStorage.getItem('pos_language') || 'en';
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3);">${lang === 'ar' ? 'لا توجد تحويلات سابقة' : 'No transfers recorded yet'}</td></tr>`;
                return;
            }

            tbody.innerHTML = transfers.map(t => {
                const dateStr = new Date(t.date).toLocaleDateString() + ' ' + new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const fromName = allStores.find(s => s.id === t.fromStoreId)?.name || t.fromStoreId;
                const toName = allStores.find(s => s.id === t.toStoreId)?.name || t.toStoreId;
                const items = Array.isArray(t.items) ? t.items : [];
                const itemsCount = items.reduce((acc, i) => acc + (i.qty || 0), 0);

                return `
                    <tr>
                        <td style="font-size:0.8rem;color:var(--text-2)">${dateStr}</td>
                        <td style="font-weight:600">${fromName}</td>
                        <td style="font-weight:600">${toName}</td>
                        <td>
                            <span class="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold bg-blue-100 text-blue-800">
                                ${itemsCount} items (${items.length} skus)
                            </span>
                        </td>
                        <td style="font-size:0.8rem">${t.transferredBy || '-'}</td>
                        <td style="font-size:0.8rem;color:var(--text-3)">${t.notes || '-'}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('History load error:', err);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);">Connection error</td></tr>`;
        }
    };

    // ── Init ──────────────────────────────────────────────────────
    loadStores().then(() => loadHistory());
});
