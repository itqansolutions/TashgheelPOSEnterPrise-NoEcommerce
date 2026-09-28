// js/purchases-app.js
// API_URL is provided by auth.js

let suppliers = [];
let stores = [];
let allProducts = [];
let filteredProducts = [];
let purchaseCart = [];

document.addEventListener('DOMContentLoaded', () => {
    loadSuppliers();
    loadStores();
    loadProducts();
    loadRecentPurchases();

    document.getElementById('productSearch').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query === '') {
            filteredProducts = [];
        } else {
            filteredProducts = allProducts.filter(p => {
                const matchName = p.name && p.name.toLowerCase().includes(query);
                const matchBarcode = p.barcode && String(p.barcode).toLowerCase().includes(query);
                const matchVariants = p.hasVariants && Array.isArray(p.variants) && p.variants.some(v =>
                    (v.barcode && String(v.barcode).toLowerCase().includes(query)) ||
                    (v.sku && String(v.sku).toLowerCase().includes(query)) ||
                    (v.attributes && Object.values(v.attributes).some(a => String(a).toLowerCase().includes(query)))
                );
                return matchName || matchBarcode || matchVariants;
            }).slice(0, 15);
        }
        renderProductResults();
    });
});

async function loadSuppliers() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/suppliers`, {
            headers: { 'x-auth-token': token }
        });
        suppliers = await res.json();
        
        const select = document.getElementById('purchaseSupplier');
        select.innerHTML = '<option value="">-- Select Supplier --</option>';
        suppliers.forEach(supp => {
            const opt = document.createElement('option');
            opt.value = supp.id;
            opt.textContent = supp.name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error(err);
    }
}

async function loadStores() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/stores`, {
            headers: { 'x-auth-token': token }
        });
        stores = await res.json();
        
        const select = document.getElementById('purchaseStore');
        select.innerHTML = '<option value="">-- Select Warehouse --</option>';
        
        const activeStore = (window.StoreContext ? window.StoreContext.getActiveStoreId() : null) || localStorage.getItem('pos_selected_store');

        stores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.isReconciling ? `🔒 ${s.name} (قيد الجرد)` : s.name;
            if (activeStore && String(s.id) === String(activeStore)) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });

        select.addEventListener('change', (e) => {
            if (e.target.value) {
                if (window.StoreContext) window.StoreContext.setActiveStoreId(e.target.value, 'purchasesSelector');
                else localStorage.setItem('pos_selected_store', e.target.value);
            }
        });
    } catch (err) {
        console.error(err);
    }
}

async function loadProducts() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/products`, {
            headers: { 'x-auth-token': token }
        });
        allProducts = await res.json();
    } catch (err) {
        console.error(err);
    }
}

async function loadRecentPurchases() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/purchases`, {
            headers: { 'x-auth-token': token }
        });
        const purchases = await res.json();
        
        const tbody = document.getElementById('purchases-body');
        tbody.innerHTML = '';
        
        purchases.slice(0, 15).forEach(pur => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(pur.date).toLocaleString()}</td>
                <td>${pur.receiptId}</td>
                <td>${pur.supplierId ? pur.supplierId.name : '-'}</td>
                <td>${pur.total.toFixed(2)}</td>
                <td>${(pur.cashPaid || 0).toFixed(2)}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
    }
}

function renderProductResults() {
    const container = document.getElementById('productResults');
    container.innerHTML = '';
    
    if (filteredProducts.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">لا توجد نتائج مطابقة للبحث</p>';
        return;
    }

    filteredProducts.forEach(prod => {
        const hasVars = prod.hasVariants && Array.isArray(prod.variants) && prod.variants.length > 0;
        const div = document.createElement('div');
        div.style.cssText = "padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;";
        
        const trackStockLabel = prod.trackStock !== false 
            ? '<span class="text-xs text-emerald-600 font-bold ml-1">(مخزني / Tracked)</span>' 
            : '<span class="text-xs text-amber-600 font-bold ml-1">(خدمي / Non-Stock)</span>';
        
        const variantBadge = hasVars 
            ? `<span class="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full ml-1">${prod.variants.length} خيارات / Variants</span>` 
            : '';

        div.innerHTML = `
            <div>
                <strong>${prod.name}</strong> ${variantBadge} ${trackStockLabel}<br>
                <small class="text-gray-500">باركود / Barcode: ${prod.barcode || '-'} | التكلفة الحالية: ${(prod.cost || 0).toFixed(2)}</small>
            </div>
            <button class="btn btn-sm btn-primary" onclick="${hasVars ? `openVariantPurchaseModal('${prod.id}')` : `addToPurchaseCart('${prod.id}')`}">
                ${hasVars ? 'اختر الخيار ➜' : '+ إضافة'}
            </button>
        `;
        container.appendChild(div);
    });
}

function openVariantPurchaseModal(productId) {
    const prod = allProducts.find(p => p.id === productId);
    if (!prod || !Array.isArray(prod.variants)) return;

    const modal = document.getElementById('variantPurchaseModal');
    const title = document.getElementById('variantPurchaseModalTitle');
    const options = document.getElementById('variantPurchaseOptions');

    title.textContent = `اختر خيار التوريد: ${prod.name}`;
    options.innerHTML = '';

    prod.variants.forEach(v => {
        const attrText = v.attributes ? Object.values(v.attributes).join(' / ') : (v.sku || 'Variant');
        const vCost = (v.cost !== undefined && v.cost !== null && !isNaN(parseFloat(v.cost))) ? parseFloat(v.cost) : (prod.cost || 0);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left p-3 rounded-xl border border-gray-200 hover:border-brand-blue hover:bg-blue-50/50 transition-all flex justify-between items-center';
        btn.onclick = () => {
            addToPurchaseCart(prod.id, v.id || v.sku || v.barcode);
            closeVariantPurchaseModal();
        };

        btn.innerHTML = `
            <div>
                <strong class="text-sm text-gray-800">${attrText}</strong><br>
                <small class="text-xs text-gray-500">SKU: ${v.sku || '-'} | Barcode: ${v.barcode || '-'}</small>
            </div>
            <div class="text-right">
                <span class="text-xs text-gray-500">تكلفة الوحدة:</span>
                <strong class="text-sm text-brand-dark block">${vCost.toFixed(2)}</strong>
            </div>
        `;
        options.appendChild(btn);
    });

    modal.style.display = 'flex';
}

function closeVariantPurchaseModal() {
    const modal = document.getElementById('variantPurchaseModal');
    if (modal) modal.style.display = 'none';
}
window.openVariantPurchaseModal = openVariantPurchaseModal;
window.closeVariantPurchaseModal = closeVariantPurchaseModal;

function addToPurchaseCart(productId, variantId = null) {
    const prod = allProducts.find(p => p.id === productId);
    if (!prod) return;

    if (prod.hasVariants && Array.isArray(prod.variants) && prod.variants.length > 0 && !variantId) {
        openVariantPurchaseModal(productId);
        return;
    }

    let itemKey = prod.id;
    let itemName = prod.name;
    let itemCost = Number(prod.cost || 0);
    let itemBarcode = prod.barcode;
    let variantObj = null;

    if (variantId) {
        variantObj = (prod.variants || []).find(v => String(v.id) === String(variantId) || String(v._id) === String(variantId) || v.sku === variantId || v.barcode === variantId);
        if (variantObj) {
            itemKey = `${prod.id}_${variantObj.id || variantObj.sku || variantObj.barcode}`;
            const attrText = variantObj.attributes ? Object.values(variantObj.attributes).join(' / ') : (variantObj.sku || 'Variant');
            itemName = `${prod.name} (${attrText})`;
            itemCost = (variantObj.cost !== undefined && variantObj.cost !== null && !isNaN(parseFloat(variantObj.cost))) ? parseFloat(variantObj.cost) : (prod.cost || 0);
            itemBarcode = variantObj.barcode || variantObj.sku || prod.barcode;
        }
    }

    const existing = purchaseCart.find(item => item.itemKey === itemKey);
    if (existing) {
        existing.qty++;
    } else {
        purchaseCart.push({
            itemKey,
            productId: prod.id,
            variantId: variantObj ? String(variantObj.id || variantObj._id || variantObj.sku || variantObj.barcode || '') : null,
            barcode: itemBarcode,
            name: itemName,
            qty: 1,
            cost: itemCost,
            unitCost: itemCost
        });
    }

    closeVariantPurchaseModal();
    document.getElementById('productSearch').value = '';
    filteredProducts = [];
    renderProductResults();
    renderPurchaseCart();
}

function renderPurchaseCart() {
    const container = document.getElementById('purchaseItems');
    container.innerHTML = '';
    
    let total = 0;

    purchaseCart.forEach((item, index) => {
        total += item.qty * item.cost;
        const div = document.createElement('div');
        div.style.cssText = "margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;";
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <strong style="font-size:1.05em; color:#0f172a;">${item.name}</strong>
                <button onclick="removeFromPurchaseCart(${index})" style="background:none; border:none; color:red; cursor:pointer; font-weight:bold;" title="حذف">🗑️</button>
            </div>
            <div style="display:flex; justify-content: space-between; align-items: center; gap: 15px;">
                <div style="flex:1;">
                    <label style="font-size:0.8em; color:#666;">الكمية (Qty)</label>
                    <input type="number" min="1" value="${item.qty}" onchange="updateCartItem(${index}, 'qty', this.value)" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                </div>
                <div style="flex:1;">
                    <label style="font-size:0.8em; color:#666;">سعر التكلفة (Unit Cost)</label>
                    <input type="number" min="0" step="0.01" value="${item.cost}" onchange="updateCartItem(${index}, 'cost', this.value)" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                </div>
                <div style="text-align:right; min-width:80px;">
                    <label style="font-size:0.8em; color:#666;">الإجمالي</label><br>
                    <strong style="color:#2c3e50;">${(item.qty * item.cost).toFixed(2)}</strong>
                </div>
            </div>
        `;
        container.appendChild(div);
    });

    document.getElementById('purchaseTotal').textContent = total.toFixed(2);
}

function updateCartItem(index, field, value) {
    const val = parseFloat(value);
    if (!isNaN(val) && val >= 0) {
        purchaseCart[index][field] = val;
        if (field === 'cost') {
            purchaseCart[index].unitCost = val;
        }
        renderPurchaseCart();
    }
}

function removeFromPurchaseCart(index) {
    purchaseCart.splice(index, 1);
    renderPurchaseCart();
}

async function submitPurchase() {
    const supplierId = document.getElementById('purchaseSupplier').value;
    const storeId = document.getElementById('purchaseStore').value;
    const cashPaid = parseFloat(document.getElementById('cashPaid').value) || 0;
    
    if (!supplierId) return alert('الرجاء اختيار المورد أولاً');
    if (!storeId) return alert('الرجاء اختيار مخزن الاستلام');
    if (purchaseCart.length === 0) return alert('سلة المشتريات فارغة');

    const total = purchaseCart.reduce((acc, item) => acc + (item.qty * item.cost), 0);

    const payload = {
        supplierId,
        storeId,
        items: purchaseCart.map(item => ({
            productId: item.productId,
            variantId: item.variantId || null,
            barcode: item.barcode || null,
            name: item.name,
            qty: Number(item.qty),
            cost: Number(item.cost),
            unitCost: Number(item.cost)
        })),
        total,
        cashPaid
    };

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/purchases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const storeObj = stores.find(s => String(s.id) === String(storeId));
            const storeName = storeObj ? storeObj.name : 'المخزن المحدد';
            
            // Sync active store context so inventory and POS immediately reflect this store!
            if (window.StoreContext) window.StoreContext.setActiveStoreId(storeId, 'purchaseSuccess');
            else localStorage.setItem('pos_selected_store', storeId);

            alert(`✅ تم حفظ فاتورة المشتريات وإيداع المخزون بنجاح في (${storeName})!`);
            purchaseCart = [];
            document.getElementById('cashPaid').value = 0;
            renderPurchaseCart();
            loadSuppliers(); 
            loadProducts();
            loadRecentPurchases();
        } else {
            const err = await res.json();
            alert('فشل حفظ المشتريات: ' + (err.msg || 'Failed to submit purchase'));
        }
    } catch (err) {
        console.error(err);
        alert('حدث خطأ أثناء الاتصال بالخادم');
    }
}
