// js/inventory-app.js
// Authoritative Inventory SSOT - VariantStock & Movement-driven UI
// API_URL is provided by auth.js

let allStores = [];
let allProducts = [];
let selectedStoreId = "";
let expandedVariants = new Set();

function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

document.addEventListener("DOMContentLoaded", () => {
    loadInitialData();

    document.getElementById("warehouse-filter").addEventListener("change", (e) => {
        selectedStoreId = e.target.value;
        onWarehouseChanged();
    });

    document.getElementById("inventory-search").addEventListener("input", filterInventory);
    document.getElementById("adjust-form").addEventListener("submit", handleStockAdjustment);
});

async function loadInitialData() {
    try {
        const token = localStorage.getItem('token');
        const storesRes = await fetch(`${API_URL}/stores`, { headers: { 'x-auth-token': token } });

        if (!storesRes.ok) {
            console.error("Failed to load stores");
            return;
        }

        allStores = await storesRes.json();
        populateStoresFilter();

        if (allStores.length > 0) {
            const savedStore = localStorage.getItem('inventory_selected_store');
            selectedStoreId = (savedStore && allStores.find(s => s.id === savedStore)) ? savedStore : allStores[0].id;
            document.getElementById("warehouse-filter").value = selectedStoreId;
        }

        await fetchProductsForStore(selectedStoreId);
    } catch (error) {
        console.error("Initialization Error:", error);
    }
}

async function onWarehouseChanged() {
    localStorage.setItem('inventory_selected_store', selectedStoreId);
    await fetchProductsForStore(selectedStoreId);
}

async function fetchProductsForStore(storeId) {
    try {
        const token = localStorage.getItem('token');
        const storeParam = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
        const productsRes = await fetch(`${API_URL}/products${storeParam}`, { headers: { 'x-auth-token': token } });

        if (!productsRes.ok) {
            console.error("Failed to load products");
            return;
        }

        allProducts = await productsRes.json();
        updateReconciliationLockBanner();
        renderInventory();
    } catch (error) {
        console.error("Error loading products for store:", error);
    }
}

function updateReconciliationLockBanner() {
    const banner = document.getElementById("reconciliation-lock-banner");
    const activeStore = allStores.find(s => s.id === selectedStoreId);
    if (banner) {
        banner.style.display = (activeStore && activeStore.isReconciling) ? "flex" : "none";
    }
}

function populateStoresFilter() {
    const filter = document.getElementById("warehouse-filter");
    filter.innerHTML = "";

    allStores.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.isReconciling ? `🔒 ${s.name} (قيد الجرد)` : s.name;
        filter.appendChild(opt);
    });
}

function toggleVariants(productId) {
    if (expandedVariants.has(productId)) {
        expandedVariants.delete(productId);
    } else {
        expandedVariants.add(productId);
    }
    renderInventory();
}

function renderInventory() {
    const tbody = document.getElementById("inventory-table-body");
    tbody.innerHTML = "";

    const activeStore = allStores.find(s => s.id === selectedStoreId);
    const isLocked = activeStore && activeStore.isReconciling;

    allProducts.forEach(p => {
        const hasVariants = p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0;
        const variantStocksList = Array.isArray(p.variantStocks) ? p.variantStocks : [];

        let totalStock = 0;
        if (hasVariants) {
            totalStock = variantStocksList.reduce((sum, vs) => sum + (vs.quantity || 0), 0);
        } else {
            const vs = variantStocksList.find(s => !s.variantId);
            if (vs) {
                totalStock = vs.quantity;
            } else if (p.stores && p.stores.length > 0) {
                const storeStock = p.stores.find(s => s.storeId.toString() === selectedStoreId.toString());
                totalStock = storeStock ? storeStock.stock : 0;
            } else {
                totalStock = p.stock || 0;
            }
        }

        const row = document.createElement("tr");
        row.dataset.productId = p.id;

        // Low Stock Alert
        if (p.trackStock !== false && totalStock <= (p.minStock || 5)) {
            row.style.backgroundColor = "#fff3cd";
        }

        const stockDisplay = p.trackStock === false ? "∞" : totalStock;
        const costDisplay = (p.cost || 0).toFixed(2);

        let variantBadge = '';
        let expandToggle = '';
        if (hasVariants) {
            const isExpanded = expandedVariants.has(p.id);
            variantBadge = `<span class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 ml-1 mr-1">${p.variants.length} خيارات / Variants</span>`;
            expandToggle = `<button type="button" class="btn btn-secondary btn-sm" onclick="toggleVariants('${p.id}')" style="padding: 2px 8px; font-size: 11px; margin-right: 5px;">
                ${isExpanded ? '▲ إخفاء' : '▼ تفاصيل'}
            </button>`;
        }

        row.innerHTML = `
            <td>
                <div class="flex items-center">
                    ${expandToggle}
                    <div>
                        <div style="font-weight:bold;">${p.name} ${variantBadge}</div>
                        <div style="font-size:0.8em; color:#666;">${p.code || p.barcode || '-'}</div>
                    </div>
                </div>
            </td>
            <td>${p.barcode || "-"}</td>
            <td>${p.category || "-"}</td>
            <td>${costDisplay}</td>
            <td style="font-weight:bold; ${totalStock < 0 ? 'color:red;' : ''}">${stockDisplay}</td>
            <td>
                ${!hasVariants ? (
                    p.trackStock !== false ? 
                        `<button class="btn btn-warning btn-sm" ${isLocked ? 'disabled title="الفرع مغلق للجرد الافتتاحي"' : ''} onclick="openAdjustModal('${p.id}', '${escapeAttr(p.name)}', ${totalStock})">🛠️ Adjust</button>` 
                        : '-'
                ) : (
                    `<button class="btn btn-info btn-sm" onclick="toggleVariants('${p.id}')" style="font-size:11px;">🔍 الخيارات</button>`
                )}
            </td>
        `;
        tbody.appendChild(row);

        // If variable product and expanded, render sub-rows for each variant
        if (hasVariants && expandedVariants.has(p.id)) {
            p.variants.forEach(v => {
                const vs = variantStocksList.find(s => s.variantId === v.id);
                const vStock = vs ? vs.quantity : ((v.stock !== undefined && v.stock !== null) ? v.stock : 0);
                const vCost = (v.cost !== undefined && v.cost !== null && !isNaN(parseFloat(v.cost))) ? parseFloat(v.cost).toFixed(2) : costDisplay;
                const vTitle = v.attributes ? Object.values(v.attributes).join(' / ') : (v.sku || 'Variant');

                const subRow = document.createElement("tr");
                subRow.className = "variant-sub-row bg-slate-50";
                subRow.dataset.productId = p.id;
                subRow.dataset.variantId = v.id;

                subRow.innerHTML = `
                    <td style="padding-left: 2.5rem;">
                        <span class="text-blue-500 font-bold mr-1">↳</span>
                        <strong class="text-slate-800">${vTitle}</strong>
                        <span class="text-xs text-gray-500 ml-2">(${v.sku || '-'})</span>
                    </td>
                    <td class="text-xs text-gray-500">${v.barcode || v.sku || '-'}</td>
                    <td class="text-xs text-gray-400">Variant</td>
                    <td>${vCost}</td>
                    <td style="font-weight:bold; ${vStock < 0 ? 'color:red;' : 'color:#1e40af;'}">${vStock}</td>
                    <td>
                        <button class="btn btn-warning btn-sm" ${isLocked ? 'disabled title="الفرع مغلق للجرد الافتتاحي"' : ''} 
                                onclick="openAdjustModal('${p.id}', '${escapeAttr(p.name)}', ${vStock}, '${v.id}', '${escapeAttr(vTitle)}')">
                            🛠️ Adjust Variant
                        </button>
                    </td>
                `;
                tbody.appendChild(subRow);
            });
        }
    });
}

function filterInventory() {
    const query = document.getElementById("inventory-search").value.toLowerCase();
    const rows = document.querySelectorAll("#inventory-table-body tr");
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? "" : "none";
    });
}

// --- ADJUSTMENT LOGIC ---

function openAdjustModal(productId, productName, currentStock, variantId = null, variantName = null) {
    const store = allStores.find(s => s.id === selectedStoreId);
    if (store && store.isReconciling) {
        alert("لا يمكن إجراء تعديل يدوي: هذا المخزن مغلق حالياً لإجراء الجرد الافتتاحي.");
        return;
    }

    document.getElementById("adjust-product-id").value = productId;
    document.getElementById("adjust-variant-id").value = variantId || "";
    document.getElementById("adjust-product-name").textContent = productName;

    const variantNameEl = document.getElementById("adjust-variant-name");
    if (variantNameEl) {
        if (variantName) {
            variantNameEl.textContent = `خيار: ${variantName}`;
            variantNameEl.style.display = "inline";
        } else {
            variantNameEl.textContent = "";
            variantNameEl.style.display = "none";
        }
    }

    document.getElementById("adjust-warehouse-name").textContent = store ? store.name : "N/A";
    document.getElementById("adjust-old-stock").value = currentStock;
    document.getElementById("adjust-new-stock").value = currentStock;
    document.getElementById("adjust-reason").value = "Audit";

    document.getElementById("adjustModal").style.display = "flex";
}

function closeAdjustModal() {
    document.getElementById("adjustModal").style.display = "none";
}

async function handleStockAdjustment(e) {
    e.preventDefault();

    const productId = document.getElementById("adjust-product-id").value;
    const variantId = document.getElementById("adjust-variant-id").value || null;
    const newStock = parseInt(document.getElementById("adjust-new-stock").value);
    const reason = document.getElementById("adjust-reason").value;
    const storeId = selectedStoreId;

    if (isNaN(newStock)) return alert("Invalid stock value");

    const payload = {
        storeId,
        items: [
            { productId, variantId, newStock, reason }
        ]
    };

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/inventory/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert("Stock adjusted successfully");
            closeAdjustModal();
            await fetchProductsForStore(selectedStoreId);
        } else {
            const err = await res.json();
            if (res.status === 423 || err.code === 'STORE_LOCKED_FOR_RECONCILIATION') {
                alert("🔒 عذراً: هذا المخزن مغلق حالياً لإجراء الجرد الافتتاحي. تم إيقاف التعديلات اليدوية لحين اعتماد الجرد.");
            } else {
                alert("Error: " + (err.msg || "Failed to adjust stock"));
            }
        }
    } catch (error) {
        console.error(error);
        alert("Server error during adjustment");
    }
}

// Global Refresh Helper
window.loadInventory = () => fetchProductsForStore(selectedStoreId);
window.openAdjustModal = openAdjustModal;
window.closeAdjustModal = closeAdjustModal;
window.toggleVariants = toggleVariants;
