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
        const query = e.target.value.toLowerCase();
        if (query.trim() === '') {
            filteredProducts = [];
        } else {
            filteredProducts = allProducts.filter(p => 
                (p.name && p.name.toLowerCase().includes(query)) ||
                (p.barcode && String(p.barcode).toLowerCase().includes(query))
            ).slice(0, 10);
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
        stores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            select.appendChild(opt);
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
    
    filteredProducts.forEach(prod => {
        const div = document.createElement('div');
        div.style.cssText = "padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;";
        
        const trackStockLabel = prod.trackStock !== false ? '<span style="color:green; font-size:0.8em;">(Inventory Tracked)</span>' : '<span style="color:orange; font-size:0.8em;">(Non-Stock/Service)</span>';
        
        div.innerHTML = `
            <div>
                <strong>${prod.name}</strong> ${trackStockLabel}<br>
                <small>Barcode: ${prod.barcode || '-'} | Current Cost: ${prod.cost?.toFixed(2) || 0}</small>
            </div>
            <button class="btn btn-sm btn-primary" onclick="addToPurchaseCart('${prod.id}')">+</button>
        `;
        container.appendChild(div);
    });
}

function addToPurchaseCart(productId) {
    const prod = allProducts.find(p => p.id === productId);
    if (!prod) return;

    const existing = purchaseCart.find(item => item.productId === productId);
    if (existing) {
        existing.qty++;
    } else {
        purchaseCart.push({
            productId: prod.id,
            barcode: prod.barcode,
            name: prod.name,
            qty: 1,
            cost: prod.cost || 0
        });
    }
    
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
                <strong style="font-size:1.1em;">${item.name}</strong>
                <button onclick="removeFromPurchaseCart(${index})" style="background:none; border:none; color:red; cursor:pointer; font-weight:bold;">🗑️</button>
            </div>
            <div style="display:flex; justify-content: space-between; align-items: center; gap: 15px;">
                <div style="flex:1;">
                    <label style="font-size:0.8em; color:#666;">Qty</label>
                    <input type="number" min="1" value="${item.qty}" onchange="updateCartItem(${index}, 'qty', this.value)" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                </div>
                <div style="flex:1;">
                    <label style="font-size:0.8em; color:#666;">Unit Cost</label>
                    <input type="number" min="0" value="${item.cost}" onchange="updateCartItem(${index}, 'cost', this.value)" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                </div>
                <div style="text-align:right; min-width:80px;">
                    <label style="font-size:0.8em; color:#666;">Subtotal</label><br>
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
    if (val >= 0) {
        purchaseCart[index][field] = val;
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
    
    if (!supplierId) return alert('Please select a supplier');
    if (!storeId) return alert('Please select a destination warehouse');
    if (purchaseCart.length === 0) return alert('Cart is empty');

    const total = purchaseCart.reduce((acc, item) => acc + (item.qty * item.cost), 0);

    const payload = {
        supplierId,
        storeId,
        items: purchaseCart,
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
            alert('Purchase submitted successfully');
            purchaseCart = [];
            document.getElementById('cashPaid').value = 0;
            renderPurchaseCart();
            loadSuppliers(); 
            loadRecentPurchases();
        } else {
            const err = await res.json();
            alert('Error: ' + (err.msg || 'Failed to submit purchase'));
        }
    } catch (err) {
        console.error(err);
    }
}
