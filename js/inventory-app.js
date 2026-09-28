// js/inventory-app.js
// PHASE 2A.6: Authoritative Inventory SSOT - VariantStock & Movement-driven UI
// API_URL is provided by auth.js

let inventoryData = {
    store: null,
    items: [],
    totalItems: 0
};
let selectedStoreId = "";
let lowStockFilterActive = false;

function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Initialize Global Store Context on selector
    const selector = document.getElementById("warehouse-filter");
    if (selector && window.StoreContext) {
        selectedStoreId = await window.StoreContext.syncSelector(selector, (newStoreId) => {
            selectedStoreId = newStoreId;
            loadInventory();
        });
    } else {
        selectedStoreId = localStorage.getItem('pos_selected_store') || "";
    }

    // 2. Setup listeners
    document.getElementById("inventory-search")?.addEventListener("input", filterInventoryTable);
    document.getElementById("adjust-form")?.addEventListener("submit", handleStockAdjustment);

    // 3. Initial load
    await loadInventory();
});

async function loadInventory() {
    if (!selectedStoreId) {
        selectedStoreId = window.StoreContext ? window.StoreContext.getActiveStoreId() : localStorage.getItem('pos_selected_store');
    }
    if (!selectedStoreId) return;

    await Promise.all([
        fetchStoreInventory(selectedStoreId),
        fetchInventoryKPIs(selectedStoreId)
    ]);
}

async function fetchStoreInventory(storeId) {
    const tbody = document.getElementById("inventory-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i> جاري تحميل المخزون... / Loading inventory...</td></tr>`;
    }

    try {
        const token = localStorage.getItem('token');
        const lowStockChecked = document.getElementById("filter-low-stock")?.checked || lowStockFilterActive;
        const lowStockParam = lowStockChecked ? '&lowStockOnly=true' : '';

        const res = await fetch(`${API_URL}/inventory/store-stock?storeId=${encodeURIComponent(storeId)}${lowStockParam}`, {
            headers: { 'x-auth-token': token }
        });

        if (!res.ok) {
            console.error("Failed to load store inventory");
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-red-500">فشل في تحميل المخزون</td></tr>`;
            return;
        }

        inventoryData = await res.json();

        // Update Store Status Badge & Lock Banner
        updateStoreStatusUI(inventoryData.store);

        // Render modernized table
        renderInventoryTable();
    } catch (err) {
        console.error("Error loading store inventory:", err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-red-500">حدث خطأ أثناء الاتصال بالسيرفر</td></tr>`;
    }
}

async function fetchInventoryKPIs(storeId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/inventory/summary?storeId=${encodeURIComponent(storeId)}`, {
            headers: { 'x-auth-token': token }
        });
        if (!res.ok) return;

        const kpis = await res.json();

        const elUnits = document.getElementById("kpi-total-units");
        const elVal = document.getElementById("kpi-total-valuation");
        const elLow = document.getElementById("kpi-low-stock");
        const elOut = document.getElementById("kpi-out-stock");
        const elCur = document.getElementById("kpi-currency");

        if (elUnits) elUnits.textContent = Number(kpis.totalUnits || 0).toLocaleString();
        if (elVal) elVal.textContent = Number(kpis.totalValuation || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (elLow) elLow.textContent = Number(kpis.lowStockCount || 0).toLocaleString();
        if (elOut) elOut.textContent = Number(kpis.outOfStockCount || 0).toLocaleString();
        if (elCur) elCur.textContent = kpis.currency || 'EGP';
    } catch (err) {
        console.error("Error loading KPIs:", err);
    }
}

function updateStoreStatusUI(store) {
    const isLocked = Boolean(store && store.isReconciling);

    // 1. Status Badge
    const badgeContainer = document.getElementById("store-status-badge");
    if (badgeContainer && window.StoreContext) {
        window.StoreContext.renderStatusBadge(badgeContainer, store);
    }

    // 2. Reconciliation Lock Warning Banner
    const banner = document.getElementById("reconciliation-lock-banner");
    if (banner) {
        banner.style.display = isLocked ? "flex" : "none";
    }
}

function toggleLowStockFilter() {
    const checkbox = document.getElementById("filter-low-stock");
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        lowStockFilterActive = checkbox.checked;
        loadInventory();
    }
}

function renderInventoryTable() {
    const tbody = document.getElementById("inventory-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const items = Array.isArray(inventoryData.items) ? inventoryData.items : [];
    const isLocked = Boolean(inventoryData.store && inventoryData.store.isReconciling);

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-400">لا توجد منتجات مسجلة في هذا المخزن / No products found in this warehouse</td></tr>`;
        return;
    }

    items.forEach(item => {
        const row = document.createElement("tr");
        row.dataset.productId = item.productId;
        if (item.variantId) row.dataset.variantId = item.variantId;

        // Status badge styling
        let statusBadge = '';
        if (item.status === 'OUT_OF_STOCK') {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">🔴 نافد / Out of Stock</span>`;
            row.className = "bg-red-50/30";
        } else if (item.status === 'LOW_STOCK') {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">🟡 منخفض / Low Stock</span>`;
            row.className = "bg-amber-50/40";
        } else {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">🟢 متوفر / In Stock</span>`;
        }

        // Last movement display
        let movementDisplay = '<span class="text-gray-400 text-xs">-</span>';
        if (item.lastMovement) {
            const m = item.lastMovement;
            const deltaSign = m.quantityDelta > 0 ? `+${m.quantityDelta}` : `${m.quantityDelta}`;
            const deltaColor = m.quantityDelta > 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold';
            const mDate = new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            movementDisplay = `
                <div class="text-xs">
                    <span class="inline-block px-1.5 py-0.5 rounded bg-gray-100 font-mono text-[10px] text-gray-700 mr-1">${m.type}</span>
                    <span class="${deltaColor}">${deltaSign}</span>
                    <span class="text-[10px] text-gray-400 block">${mDate}</span>
                </div>
            `;
        }

        // Variant badge
        const variantLabel = item.hasVariants
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800">🏷️ ${item.variantName}</span>`
            : `<span class="text-xs text-gray-400 font-mono">(Standard)</span>`;

        // Stock quantity styling (Strictly SSOT)
        const qtyColor = item.quantity <= 0 ? 'text-rose-600' : 'text-slate-900';

        row.innerHTML = `
            <td class="font-semibold text-slate-800">
                ${item.productName}
                <span class="block text-[11px] text-gray-400 font-normal">${item.category}</span>
            </td>
            <td class="font-mono text-xs text-gray-600">${item.barcode || '-'}</td>
            <td>${variantLabel}</td>
            <td class="font-mono text-xs text-gray-700">${Number(item.cost || 0).toFixed(2)}</td>
            <td class="font-bold text-base ${qtyColor}">${item.quantity}</td>
            <td class="font-mono text-xs text-gray-500">${item.minStock || 0}</td>
            <td>${statusBadge}</td>
            <td>${movementDisplay}</td>
            <td>
                <button class="btn btn-warning btn-sm shadow-sm"
                        ${isLocked ? 'disabled title="الفرع مغلق حالياً لإجراء الجرد الافتتاحي"' : ''}
                        onclick="openAdjustModal('${item.productId}', '${escapeAttr(item.productName)}', ${item.quantity}, '${item.variantId || ''}', '${escapeAttr(item.variantName || '')}')">
                    🛠️ Adjust
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

function filterInventoryTable() {
    const query = (document.getElementById("inventory-search")?.value || "").toLowerCase().trim();
    const rows = document.querySelectorAll("#inventory-table-body tr");
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? "" : "none";
    });
}

function openAdjustModal(productId, productName, currentStock, variantId = '', variantName = '') {
    const isLocked = Boolean(inventoryData.store && inventoryData.store.isReconciling);
    if (isLocked) {
        alert("لا يمكن تعديل المخزون: الفرع مغلق حالياً لإجراء الجرد الافتتاحي.");
        return;
    }

    document.getElementById("adjust-product-id").value = productId;
    document.getElementById("adjust-variant-id").value = variantId;
    document.getElementById("adjust-product-name").textContent = productName;

    const varNameEl = document.getElementById("adjust-variant-name");
    if (varNameEl) {
        if (variantId && variantName) {
            varNameEl.textContent = `Variant: ${variantName}`;
            varNameEl.style.display = "inline";
        } else {
            varNameEl.style.display = "none";
        }
    }

    document.getElementById("adjust-warehouse-name").textContent = inventoryData.store?.name || selectedStoreId;
    document.getElementById("adjust-old-stock").value = currentStock;
    document.getElementById("adjust-new-stock").value = "";
    document.getElementById("adjust-new-stock").focus();

    document.getElementById("adjustModal").style.display = "flex";
}

function closeAdjustModal() {
    document.getElementById("adjustModal").style.display = "none";
    document.getElementById("adjust-form").reset();
}

async function handleStockAdjustment(e) {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const productId = document.getElementById("adjust-product-id").value;
    const variantId = document.getElementById("adjust-variant-id").value || null;
    const oldStock = parseFloat(document.getElementById("adjust-old-stock").value) || 0;
    const newStock = parseFloat(document.getElementById("adjust-new-stock").value);
    const reason = document.getElementById("adjust-reason").value;

    if (isNaN(newStock) || newStock < 0) {
        alert("يرجى إدخال رصيد فعلي صحيح (أكبر من أو يساوي صفر)");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/inventory/adjust`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': token
            },
            body: JSON.stringify({
                storeId: selectedStoreId,
                productId,
                variantId,
                newStock,
                reason
            })
        });

        const data = await res.json();

        if (res.ok) {
            closeAdjustModal();
            await loadInventory();
        } else {
            if (res.status === 423 || data.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
                alert(`⚠️ الفرع مغلق للجرد: ${data.msg || 'لا يمكن تسجيل تعديل للمخزون'}`);
            } else {
                alert(`خطأ: ${data.msg || 'فشل في حفظ التعديل'}`);
            }
        }
    } catch (err) {
        console.error("Adjustment error:", err);
        alert("حدث خطأ أثناء حفظ التعديل");
    }
}
