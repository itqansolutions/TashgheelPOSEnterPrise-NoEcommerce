// products-app.js
// API_URL is defined in auth.js

document.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  loadCategories();

  document.getElementById("product-form").addEventListener("submit", handleAddProduct);
  document.getElementById("edit-product-form").addEventListener("submit", handleUpdateProduct);
  document.getElementById("category-form-modal").addEventListener("submit", handleAddCategory);
  
  // Search listener
  const searchInput = document.getElementById("product-search");
  if (searchInput) {
      searchInput.addEventListener("input", filterProducts);
  }

  // Variants Toggle
  const variantsToggle = document.getElementById("product-has-variants");
  if (variantsToggle) {
      variantsToggle.addEventListener("change", (e) => {
          document.getElementById("variants-section").style.display = e.target.checked ? "block" : "none";
      });
  }

  // Expose functions globally
  window.openCategoryModal = openCategoryModal;
  window.closeCategoryModal = closeCategoryModal;
  window.deleteCategory = deleteCategory;
  window.deleteProduct = deleteProduct;
  window.editProduct = editProduct;
  window.generateVariants = generateVariants;
});

// --- SEARCH ---
function filterProducts() {
    const term = document.getElementById("product-search").value.toLowerCase();
    const rows = document.querySelectorAll("#product-table-body tr");
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(term) ? "" : "none";
    });
}

// --- VARIANTS ---
function generateVariants() {
    const optName = document.getElementById("variant-opt-name").value.trim() || "Option";
    const valuesStr = document.getElementById("variant-opt-values").value.trim();
    if (!valuesStr) return alert("Enter variant values (e.g. Red, Blue)");
    
    const values = valuesStr.split(",").map(v => v.trim()).filter(v => v);
    const tbody = document.getElementById("variants-table-body");
    
    // Default base values
    const basePrice = document.getElementById("product-price").value || "0";
    const baseCost = document.getElementById("product-cost").value || "0";

    values.forEach(val => {
        const tr = document.createElement("tr");
        tr.className = "variant-row";
        tr.innerHTML = `
            <td class="px-4 py-2 font-bold text-brand-dark">
               <input type="hidden" class="v-opt-name" value="${optName}">
               <input type="hidden" class="v-opt-value" value="${val}">
               ${val}
            </td>
            <td class="px-4 py-2"><input type="text" class="v-sku premium-input !py-1 !text-xs" placeholder="SKU/Barcode"></td>
            <td class="px-4 py-2"><input type="number" step="0.01" class="v-price premium-input !py-1 !text-xs" value="${basePrice}"></td>
            <td class="px-4 py-2"><input type="number" class="v-stock premium-input !py-1 !text-xs" value="0" style="width:60px"></td>
            <td class="px-4 py-2"><input type="number" step="0.01" class="v-price premium-input !py-1 !text-xs text-brand-green" value="${basePrice}" style="width:80px"></td>
            <td class="px-4 py-2"><input type="text" class="v-image premium-input !py-1 !text-xs" placeholder="Image URL"></td>
            <td class="px-4 py-2"><button type="button" onclick="this.closest('tr').remove()" class="text-red-500 hover:text-red-700 font-bold">X</button></td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById("variant-opt-values").value = "";
}

// --- PRODUCTS ---

async function loadProducts() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/products`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            alert("Session expired or access denied");
            window.location.href = "index.html";
        }
        return;
    }
    const products = await response.json();
    window.allProducts = products;

    renderProductTable(products);
  } catch (error) {
    console.error('Error loading products:', error);
  }
}

function renderProductTable(products) {
    const tbody = document.getElementById("product-table-body");
    tbody.innerHTML = "";

    products.forEach((p) => {
      const row = document.createElement("tr");
      
      const statusHtml = p.active !== false 
        ? `<span class="badge badge-success" data-i18n="active">${getTranslation('active')}</span>`
        : `<span class="badge badge-danger" data-i18n="inactive">${getTranslation('inactive') || 'Inactive'}</span>`;

      row.innerHTML = `
        <td>
            <div style="font-weight:bold;">${p.name}</div>
            <div style="font-size:0.8em; color:#666;">${p.code || '-'}</div>
        </td>
        <td>${p.barcode || "-"}</td>
        <td>${p.category || "-"}</td>
        <td class="text-brand-green font-bold">${p.price?.toFixed(2) || "0.00"}</td>
        <td class="font-bold">${p.stock || 0}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">🗑️</button>
        </td>
      `;
      tbody.appendChild(row);
    });
}

async function handleAddProduct(e) {
  e.preventDefault();

  const name = document.getElementById("product-name").value.trim();
  const category = document.getElementById("product-category").value;
  const barcode = document.getElementById("product-barcode").value.trim();
  const price = parseFloat(document.getElementById("product-price").value);
  const trackStock = document.getElementById("product-track-stock").checked;
  const hasVariants = document.getElementById("product-has-variants") ? document.getElementById("product-has-variants").checked : false;
  const imageUrl = document.getElementById("product-image-url").value.trim();

  if (!name || isNaN(price)) return alert("Please fill required fields");

  let variants = [];
  if (hasVariants) {
      const rows = document.querySelectorAll(".variant-row");
      rows.forEach(row => {
          variants.push({
              id: crypto.randomUUID(), // Local generate ID
              sku: row.querySelector('.v-sku').value.trim(),
              barcode: row.querySelector('.v-sku').value.trim(),
              price: parseFloat(row.querySelector('.v-price')?.value) || price,
              cost: parseFloat(row.querySelector('.v-cost')?.value) || 0,
              stock: parseInt(row.querySelector('.v-stock')?.value) || 0,
              imageUrl: row.querySelector('.v-image')?.value.trim() || '',
              attributes: {
                  [row.querySelector('.v-opt-name').value]: row.querySelector('.v-opt-value').value
              }
          });
      });
  }

  const product = {
    name,
    category,
    barcode,
    price,
    trackStock,
    imageUrl,
    hasVariants,
    variants,
    active: true
  };

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify(product)
    });

    if (response.ok) {
      alert('Product added successfully');
      e.target.reset();
      loadProducts();
    } else {
      const err = await response.json();
      alert('Failed: ' + err.msg);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

function editProduct(id) {
  const product = window.allProducts?.find(p => p.id === id);
  if (!product) return;

  document.getElementById("edit-product-id").value = product.id;
  document.getElementById("edit-product-name").value = product.name;
  document.getElementById("edit-product-barcode").value = product.barcode || "";
  document.getElementById("edit-product-price").value = product.price;
  document.getElementById("edit-product-track-stock").checked = product.trackStock !== false;
  document.getElementById("edit-product-image-url").value = product.imageUrl || "";

  // Category
  const editCat = document.getElementById("edit-product-category");
  const mainCat = document.getElementById("product-category");
  editCat.innerHTML = mainCat.innerHTML;
  editCat.value = product.category || "";

  document.getElementById("editProductModal").style.display = "flex";
}

function closeEditProductModal() {
  document.getElementById("editProductModal").style.display = "none";
}

async function handleUpdateProduct(e) {
  e.preventDefault();

  const id = document.getElementById("edit-product-id").value;
  const name = document.getElementById("edit-product-name").value.trim();
  const barcode = document.getElementById("edit-product-barcode").value.trim();
  const category = document.getElementById("edit-product-category").value;
  const price = parseFloat(document.getElementById("edit-product-price").value);
  const trackStock = document.getElementById("edit-product-track-stock").checked;
  const imageUrl = document.getElementById("edit-product-image-url").value.trim();
 
  // We are not updating variants in edit right now, but we will pass the basic fields
  const updates = { name, barcode, category, price, trackStock, imageUrl };

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/products/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify(updates)
    });

    if (response.ok) {
      alert("Updated successfully");
      closeEditProductModal();
      loadProducts();
    }
  } catch (error) {
    console.error(error);
  }
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/products/${id}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': token }
    });
    if (response.ok) loadProducts();
  } catch (e) {
    console.error(e);
  }
}

// --- CATEGORIES ---

async function loadCategories() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/categories`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) return;
    
    const categories = await response.json();
    const select = document.getElementById("product-category");
    const listBody = document.getElementById("category-list-body");

    select.innerHTML = '<option value="">-- Select Category --</option>';
    listBody.innerHTML = "";

    categories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.name;
      opt.textContent = cat.name;
      select.appendChild(opt);

      const row = document.createElement("tr");
      row.innerHTML = `
                <td>${cat.name}</td>
                <td style="text-align:right;">
                    <button class="btn btn-danger btn-sm" onclick="deleteCategory('${cat.id}')">🗑️</button>
                </td>
            `;
      listBody.appendChild(row);
    });
  } catch (error) {
    console.error(error);
  }
}

function openCategoryModal() {
  document.getElementById("categoryModal").style.display = "flex";
}

function closeCategoryModal() {
  document.getElementById("categoryModal").style.display = "none";
}

async function handleAddCategory(e) {
  e.preventDefault();
  const input = document.getElementById("new-category-modal");
  const name = input.value.trim();
  if (!name) return;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
      body: JSON.stringify({ name })
    });

    if (response.ok) {
      input.value = "";
      loadCategories();
    }
  } catch (error) {
    console.error(error);
  }
}

async function deleteCategory(id) {
  if (!confirm('Delete category?')) return;
  try {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/categories/${id}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': token }
    });
    loadCategories();
  } catch (error) {
    console.error(error);
  }
}
