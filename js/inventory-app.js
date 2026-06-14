// js/inventory-app.js
// API_URL is provided by auth.js

let allStores = [];
let allProducts = [];
let selectedStoreId = "";

document.addEventListener("DOMContentLoaded", () => {
    loadInitialData();

    document.getElementById("warehouse-filter").addEventListener("change", (e) => {
        selectedStoreId = e.target.value;
        renderInventory();
    });

    document.getElementById("inventory-search").addEventListener("input", filterInventory);
    document.getElementById("adjust-form").addEventListener("submit", handleStockAdjustment);
});

async function loadInitialData() {
    try {
        const token = localStorage.getItem('token');
        const [storesRes, productsRes] = await Promise.all([
            fetch(`${API_URL}/stores`, { headers: { 'x-auth-token': token } }),
            fetch(`${API_URL}/products`, { headers: { 'x-auth-token': token } })
        ]);

        if (!storesRes.ok || !productsRes.ok) {
            console.error("Failed to load data");
            return;
        }

        allStores = await storesRes.json();
        allProducts = await productsRes.json();

        populateStoresFilter();
        
        // Default to first store if available
        if (allStores.length > 0) {
            selectedStoreId = allStores[0].id;
            document.getElementById("warehouse-filter").value = selectedStoreId;
        }

        renderInventory();
    } catch (error) {
        console.error("Initialization Error:", error);
    }
}

function populateStoresFilter() {
    const filter = document.getElementById("warehouse-filter");
    filter.innerHTML = "";
    
    // Optional: Add "All Warehouses" if needed in future, but for adjustment we need a specific one.
    // filter.innerHTML = '<option value="all">-- All Warehouses --</option>';

    allStores.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        filter.appendChild(opt);
    });
}

function renderInventory() {
    const tbody = document.getElementById("inventory-table-body");
    tbody.innerHTML = "";

    allProducts.forEach(p => {
        // Find stock for selected store
        let stock = 0;
        if (p.stores && p.stores.length > 0) {
            const storeStock = p.stores.find(s => s.storeId.toString() === selectedStoreId.toString());
            stock = storeStock ? storeStock.stock : 0;
        }

        const row = document.createElement("tr");
        
        // Low Stock Alert
        if (p.trackStock !== false && stock <= (p.minStock || 5)) {
            row.style.backgroundColor = "#fff3cd"; 
        }

        const stockDisplay = p.trackStock === false ? "∞" : stock;
        const costDisplay = (p.cost || 0).toFixed(2);

        row.innerHTML = `
            <td>
                <div style="font-weight:bold;">${p.name}</div>
                <div style="font-size:0.8em; color:#666;">${p.code || p.barcode || '-'}</div>
            </td>
            <td>${p.barcode || "-"}</td>
            <td>${p.category || "-"}</td>
            <td>${costDisplay}</td>
            <td style="font-weight:bold; ${stock < 0 ? 'color:red;' : ''}">${stockDisplay}</td>
            <td>
                ${p.trackStock !== false ? `<button class="btn btn-warning btn-sm" onclick="openAdjustModal('${p.id}', '${p.name}', ${stock})">🛠️ Adjust</button>` : '-'}
            </td>
        `;
        tbody.appendChild(row);
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

function openAdjustModal(productId, productName, currentStock) {
    const store = allStores.find(s => s.id === selectedStoreId);
    
    document.getElementById("adjust-product-id").value = productId;
    document.getElementById("adjust-product-name").textContent = productName;
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
    const newStock = parseInt(document.getElementById("adjust-new-stock").value);
    const reason = document.getElementById("adjust-reason").value;
    const storeId = selectedStoreId;

    if (isNaN(newStock)) return alert("Invalid stock value");

    const payload = {
        storeId,
        items: [
            { productId, newStock, reason }
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
            loadInitialData(); // Refresh everything
        } else {
            const err = await res.json();
            alert("Error: " + (err.msg || "Failed to adjust stock"));
        }
    } catch (error) {
        console.error(error);
        alert("Server error during adjustment");
    }
}

// Global Refresh Helper
window.loadInventory = loadInitialData;
window.openAdjustModal = openAdjustModal;
window.closeAdjustModal = closeAdjustModal;
