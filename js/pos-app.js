
// POS JS with salesman support and fixed receipt printing (final version)
console.log("POS Script Starting...");
let allProducts = [];
let filteredProducts = [];
let cart = [];
let heldTransactions = JSON.parse(localStorage.getItem('heldTransactions')) || [];
let currentShift = null;
let isReadOnly = false;
let heldOrdersInterval = null;
let transactionStartTime = null;
window.cart = cart; // Debug access
// Ensure API_URL is available
// Ensure API_URL is available
if (typeof API_URL === 'undefined') {
  window.API_URL = '/api';
}

// Helper to print content via iframe (no new tab)
window.printContent = function (html) {
  const iframeId = 'print-iframe';
  let iframe = document.getElementById(iframeId);

  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.style.position = 'absolute';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);
  }

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Wait for content to load then print
  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
  }, 500);
}

// ===================== INIT =====================
// SHIFT MANAGEMENT

async function checkOpenShift() {
  try {
    const token = localStorage.getItem('token');
    const shiftRes = await fetch(`${API_URL}/shifts/current`, {
      headers: { 'x-auth-token': token }
    });

    const shift = await shiftRes.json();

    // Load available stores for this user
    const user = JSON.parse(localStorage.getItem('currentUser'));
    const storesRes = await fetch(`${API_URL}/stores`, {
        headers: { 'x-auth-token': token }
    });
    const allStores = await storesRes.json();
    
    // Filter stores based on user permissions
    let allowedStores = [];
    if (Array.isArray(allStores)) {
        if (user.role === 'admin') {
            allowedStores = allStores;
        } else {
            allowedStores = allStores.filter(s => (user.allowedStores || []).includes(s.id));
        }
    }

    const storeSelect = document.getElementById('storeSelect');
    const posWarehouseSelector = document.getElementById('pos-warehouse-selector');
    
    if (storeSelect) {
        storeSelect.innerHTML = '';
        allowedStores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            storeSelect.appendChild(opt);
        });
    }

    if (posWarehouseSelector) {
        posWarehouseSelector.innerHTML = '';
        allowedStores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            posWarehouseSelector.appendChild(opt);
        });
        posWarehouseSelector.addEventListener('change', () => {
            renderProducts();
            localStorage.setItem('pos_selected_store', posWarehouseSelector.value);
        });
        
        // Restore last selected store if available
        const savedStore = localStorage.getItem('pos_selected_store');
        if (savedStore && allowedStores.find(s => s.id === savedStore)) {
            posWarehouseSelector.value = savedStore;
        }
    }

    // Get current user safely from storage, fallback to DOM if needed, but storage is source of truth
    let currentUser = 'User';
    try {
      const userObj = JSON.parse(localStorage.getItem('currentUser'));
      if (userObj && userObj.username) currentUser = userObj.username;
    } catch (e) {
      console.error("Error parsing user", e);
    }

    console.log(`Shift Check: Shift Cashier = '${shift?.cashier}', Current User = '${currentUser}'`);

    if (!shift) {
      // No open shift, show modal
      const modal = document.getElementById('openShiftModal');
      if (modal) modal.style.display = 'flex';
      else console.warn('openShiftModal not found');
      disablePOS();
    } else {
      localStorage.setItem('pos_selected_store', shift.storeId);
      // Shift exists. Check ownership.
      if (shift.cashier === currentUser) {
        // Same user.
        // Check if we already resumed this session
        if (sessionStorage.getItem('shiftResumed') === 'true') {
          console.log("Shift already resumed this session.");
          enablePOS();
          return;
        }

        // Offer to Resume.
        const resumeShiftTimeEl = document.getElementById('resumeShiftTime');
        const resumeShiftModalEl = document.getElementById('resumeShiftModal');
        if (resumeShiftTimeEl) {
          resumeShiftTimeEl.textContent = new Date(shift.startTime).toLocaleString();
        }
        if (resumeShiftModalEl) {
          resumeShiftModalEl.style.display = 'flex';
        }
        disablePOS();
      } else {
        // Different user. Read Only Mode.
        console.log("Read Only Mode Activated");
        isReadOnly = true;
        enableReadOnlyMode(shift.cashier);
      }
    }
  } catch (error) {
    console.error('Error checking shift:', error);
    alert('Failed to check shift status: ' + error.message);
  }
}

function enableReadOnlyMode(ownerName) {
  const banner = document.getElementById('readOnlyBanner');
  const userSpan = document.getElementById('readOnlyUser');
  if (banner && userSpan) {
    userSpan.textContent = ownerName;
    banner.style.display = 'block';
  }

  // Enable search and navigation, but disable actions
  enablePOS(); // First enable everything
  isReadOnly = true;

  // Disable transaction buttons
  const buttonsToDisable = ['cashBtn', 'cardBtn', 'mobileBtn', 'creditBtn', 'holdBtn', 'clearCartBtn', 'closeShiftBtn', 'scanBtn'];
  buttonsToDisable.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;
    // Also disable parent button if it's the span inside
    if (id === 'closeShiftBtn') {
      const closeBtn = btn.closest('button');
      if (closeBtn) closeBtn.disabled = true;
    }
  });

  // Disable adding to cart?
  // Maybe allow adding to see total but prevent checkout.
  // The requirement says "deny making any transaction". 
  // I will allow adding to cart to calculator totals, but checkout is blocked by disabled buttons + check in processSale.
}

function resumeShift() {
  document.getElementById('resumeShiftModal').style.display = 'none';
  sessionStorage.setItem('shiftResumed', 'true');
  enablePOS();
}

function closeShiftFromResume() {
  document.getElementById('resumeShiftModal').style.display = 'none';
  closeShift(); // Opens the close modal logic
}

function disablePOS() {
  document.querySelectorAll('.btn').forEach(btn => {
    if (btn && !btn.closest('#openShiftModal') && !btn.closest('#resumeShiftModal') && !btn.closest('.sidebar-footer')) {
      btn.disabled = true;
    }
  });
  const search = document.getElementById('productSearch');
  if (search) search.disabled = true;
}

function enablePOS() {
  document.querySelectorAll('.btn').forEach(btn => { if (btn) btn.disabled = false; });
  const search = document.getElementById('productSearch');
  if (search) search.disabled = false;
  if (typeof updateCartSummary === 'function') updateCartSummary();
}

function enterWithoutShift() {
  document.getElementById('openShiftModal').style.display = 'none';
  const noShiftMsg = getTranslation('enter_no_shift') || 'No Active Shift';
  enableReadOnlyMode(noShiftMsg);
}

async function submitOpenShift() {
  const startCash = parseFloat(document.getElementById('startCashInput').value);
  const storeId = document.getElementById('storeSelect').value;
  
  if (isNaN(startCash)) return alert('Please enter valid start cash');
  if (!storeId) return alert('Please select a store');

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/shifts/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify({ startCash, storeId })
    });

    if (response.ok) {
      document.getElementById('openShiftModal').style.display = 'none';
      sessionStorage.setItem('shiftResumed', 'true');
      enablePOS();
      alert('Shift opened successfully!');
    } else {
      const data = await response.json();
      alert('Failed to open shift: ' + (data.msg || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error opening shift:', error);
    alert('Server error');
  }
}

window.closeShift = async function () {
  try {
    const token = localStorage.getItem('token');
    if (!token) { console.error("No token"); return; }

    // Check if API_URL is defined
    if (typeof API_URL === 'undefined') {
      alert('System Error: API_URL not defined. Reload page.');
      return;
    }

    if (heldTransactions.length > 0) {
      alert("Cannot close shift: You have held orders active. Please process or discard them first.");
      return;
    }

    const response = await fetch(`${API_URL}/shifts/summary`, {
      headers: { 'x-auth-token': token }
    });

    if (response.ok) {
      const data = await response.json();
      window.lastShiftSummary = data; // Store for printing


      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val.toFixed(2);
      };

      setVal('summaryStartCash', data.startCash);
      setVal('summaryCashSales', data.cashSales);
      setVal('summaryCardSales', data.cardSales);
      setVal('summaryMobileSales', data.mobileSales);
      setVal('summaryReturns', data.totalRefunds);
      setVal('summaryExpenses', data.expensesTotal);
      setVal('summaryExpectedCash', data.expectedCash);

      const modal = document.getElementById('closeShiftModal');
      if (modal) modal.style.display = 'flex';
    } else {
      alert('Failed to load shift summary');
    }
  } catch (err) {
    console.error(err);
    alert('Error loading summary');
  }
};

window.submitCloseShift = async function () {
  const actualCash = parseFloat(document.getElementById('actualCashInput')?.value || 0);
  const actualCard = parseFloat(document.getElementById('actualCardInput')?.value || 0);
  const actualMobile = parseFloat(document.getElementById('actualMobileInput')?.value || 0);

  if (isNaN(actualCash)) return alert('Please enter actual cash amount');

  if (!confirm('Are you sure you want to close the shift?')) return;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/shifts/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify({ actualCash, actualCard, actualMobile })
    });

    if (response.ok) {
      // Generate and Print Report
      if (window.lastShiftSummary) {
        const summary = window.lastShiftSummary;
        const shopName = localStorage.getItem('shopName') || 'My Shop';
        const cashier = JSON.parse(localStorage.getItem('currentUser'))?.username || 'User';
        const now = new Date();

        // Prepare data for report
        const reportData = {
          shopName,
          startTime: new Date().toLocaleDateString() + " (Start)", // ideally we should get this from summary properties if available, or just print current "End"
          endTime: new Date().toLocaleString(),
          cashier,
          startCash: summary.startCash,

          sysCash: summary.cashSales,
          sysCard: summary.cardSales,
          sysMobile: summary.mobileSales,

          actCash: actualCash,
          actCard: actualCard,
          actMobile: actualMobile,

          returns: summary.totalRefunds || 0,
          expenses: summary.expensesTotal || 0,

          expectedCash: summary.expectedCash,
          diffCash: actualCash - summary.expectedCash,

          // Optional: we can calc diff for card/mobile too if we want "expected card" = sysCard
          diffCard: actualCard - summary.cardSales,
          diffMobile: actualMobile - summary.mobileSales
        };

        const html = generateShiftReportHTML(reportData);
        window.printContent(html);

        // Wait for print to likely execute before reloading
        setTimeout(() => {
          alert('Shift closed successfully!');
          sessionStorage.removeItem('shiftResumed');
          location.reload();
        }, 1500);
      } else {
        // Fallback if summary missing
        alert('Shift closed successfully!');
        sessionStorage.removeItem('shiftResumed');
        location.reload();
      }

    } else {
      alert('Failed to close shift');
      location.reload(); // still reload to be safe? No, let user retry or see error.
    }
  } catch (error) {
    console.error('Error closing shift:', error);
    alert("Error closing shift");
  }
};

function generateShiftReportHTML(data) {
  const lang = localStorage.getItem('pos_language') || 'en';
  const t = (en, ar) => (lang === 'ar' ? ar : en);

  const style = `
    body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; padding: 5px; direction: ${lang === 'ar' ? 'rtl' : 'ltr'}; }
    .header { text-align: center; margin-bottom: 10px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
    .line { border-top: 1px dashed #000; margin: 5px 0; }
    .bold { font-weight: bold; }
  `;

  return `
    <html>
      <head><style>${style}</style></head>
      <body>
        <div class="header">
          <h2 style="margin:0">${data.shopName}</h2>
          <h3 style="margin:5px 0">${t("SHIFT CLOSE REPORT", "تقرير إغلاق وردية")}</h3>
          <p style="margin:0">${data.endTime}</p>
          <p style="margin:0">${t("Cashier:", "الكاشير:")} ${data.cashier}</p>
        </div>
        
        <div class="line"></div>
        
        <table style="width:100%; border-collapse: collapse;">
          <tr>
            <td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Start Cash", "بداية الدرج")}</td>
            <td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.startCash.toFixed(2)}</td>
          </tr>
        </table>
        
        <div class="line"></div>
        <div style="text-align:center;font-weight:bold;margin-bottom:5px;">${t("SYSTEM TOTALS", "إجماليات النظام")}</div>
        
        <table style="width:100%; border-collapse: collapse;">
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Cash Sales", "مبيعات الكاش")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.sysCash.toFixed(2)}</td></tr>
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Card Sales", "مبيعات البطاقة")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.sysCard.toFixed(2)}</td></tr>
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Mobile Sales", "مبيعات المحافظ")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.sysMobile.toFixed(2)}</td></tr>
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Returns", "المرتجعات")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">(${data.returns.toFixed(2)})</td></tr>
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Expenses", "المصاريف")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">(${data.expenses.toFixed(2)})</td></tr>
        </table>
        
        <div class="line"></div>
         <div style="text-align:center;font-weight:bold;margin-bottom:5px;">${t("ACTUAL TOTALS", "الإجماليات الفعلية")}</div>
         
         <table style="width:100%; border-collapse: collapse; font-weight: bold;">
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Act. Cash", "الكاش الفعلي")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.actCash.toFixed(2)}</td></tr>
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Act. Card", "البطاقة الفعلية")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.actCard.toFixed(2)}</td></tr>
          <tr><td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Act. Mobile", "المحافظ الفعلية")}</td><td style="text-align:${lang === 'ar' ? 'left' : 'right'}">${data.actMobile.toFixed(2)}</td></tr>
        </table>

        <div class="line"></div>
        <div style="text-align:center;font-weight:bold;margin-bottom:5px;">${t("DIFFERENCES", "الفروقات")}</div>
        
        <table style="width:100%; border-collapse: collapse;">
          <tr>
            <td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Cash Diff", "فرق الكاش")}</td>
            <td style="text-align:${lang === 'ar' ? 'left' : 'right'}; ${data.diffCash < 0 ? 'color:red' : 'color:black'}">${data.diffCash.toFixed(2)}</td>
          </tr>
           <tr>
            <td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Card Diff", "فرق البطاقة")}</td>
            <td style="text-align:${lang === 'ar' ? 'left' : 'right'}; ${data.diffCard < 0 ? 'color:red' : 'color:black'}">${data.diffCard.toFixed(2)}</td>
          </tr>
           <tr>
            <td style="text-align:${lang === 'ar' ? 'right' : 'left'}">${t("Mobile Diff", "فرق المحافظ")}</td>
            <td style="text-align:${lang === 'ar' ? 'left' : 'right'}; ${data.diffMobile < 0 ? 'color:red' : 'color:black'}">${data.diffMobile.toFixed(2)}</td>
          </tr>
         </table>

        <div class="line"></div>
        <p style="text-align:center;">${t("Signature", "التوقيع")}: ________________</p>
      </body>
    </html>
  `;
}

async function checkTrialStatus() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/tenant/trial-status`, {
      headers: { 'x-auth-token': token }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.isExpired) {
        document.body.innerHTML = `
  < div style = "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#f8f9fa;text-align:center;" >
    <div style="background:white;padding:40px;border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.1);max-width:500px;">
      <h1 style="color:#e74c3c;margin-bottom:20px;">Trial Expired</h1>
      <p style="font-size:18px;margin-bottom:30px;">Your trial period has ended. Please contact support to activate the full version.</p>
      <div style="font-weight:bold;color:#2c3e50;margin-bottom:20px;">
        <p>📞 +201126522373</p>
        <p>📧 info@itqansolutions.org</p>
      </div>
      <button onclick="window.location.href='index.html'" class="btn btn-primary" style="margin-top:20px;">Back to Login</button>
    </div>
          </div >
  `;
      } else if (data.daysRemaining <= 3) {
        // Show warning banner
        const banner = document.createElement('div');
        const lang = localStorage.getItem('pos_language') || 'en';
        const t = (en, ar) => (lang === 'ar' ? ar : en);
        
        banner.style.cssText = `
          background: ${data.daysRemaining <= 1 ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #f59e0b, #d97706)'};
          color: white;
          text-align: center;
          padding: 12px 20px;
          font-weight: bold;
          position: sticky;
          top: 0;
          z-index: 9999;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1);
          font-size: 0.85rem;
          backdrop-filter: blur(10px);
        `;
        banner.innerHTML = `
          <div style="display:flex; justify-content:center; align-items:center; gap: 10px;">
            <span>⚠️ ${t('Trial Version:', 'نسخة تجريبية:')} ${data.daysRemaining} ${t('days remaining.', 'أيام متبقية.')}</span>
            <a href="tel:+201126522373" style="background:rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color:white; text-decoration:none; font-size: 0.75rem; transition: all 0.2s; border: 1px solid rgba(255,255,255,0.4);">
              ${t('Contact to Activate', 'تواصل للتفعيل')}
            </a>
          </div>
        `;
        document.body.prepend(banner);
      }
    }
  } catch (error) {
    console.error('Failed to check trial status:', error);
  }
}

// يربط السيرش مرة واحدة فقط
function bindSearchOnce() {
  const el = document.getElementById("productSearch");
  if (el && !el.dataset.bound) {
    el.addEventListener("input", handleSearch);
    el.dataset.bound = "1";
  }
}

// يتأكد ان السيرش شغال أي وقت ومش متغطي
function ensureSearchClickable() {
  const el = document.getElementById("productSearch");
  if (el) {
    el.style.pointerEvents = "auto";
    el.style.position = "relative";
    el.style.zIndex = "1000";
    // يقفل أي مودال ممكن لسه مفتوح بالغلط
    ["discountModal", "auditModal"].forEach(id => {
      const m = document.getElementById(id);
      if (m && getComputedStyle(m).display !== "none") {
        m.style.display = "none";
      }
    });
    // ضمان الفوكس أول ما يفتح في كل البيئات
    el.addEventListener("mousedown", () => el.focus(), { once: true });
  }
}

// ===================== LOAD PRODUCTS =====================
async function loadProducts() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/products`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) throw new Error('Failed to fetch products');

    const products = await response.json();
    allProducts = products.filter(p => p.active !== false); // Filter only active products
    filteredProducts = allProducts;
    renderProducts();

    if (products.length === 0) {
      console.warn('No products found in database');
    }
  } catch (error) {
    console.error('Error loading products:', error);
    alert('Failed to load products. Ensure server is running at ' + API_URL);
    // Fallback to empty or show error
    allProducts = [];
    filteredProducts = [];
    renderProducts();
  }
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  grid.innerHTML = "";
  
  const lang = localStorage.getItem('pos_language') || 'en';
  const t = (en, ar) => (lang === 'ar' ? ar : en);

  if (filteredProducts.length === 0) {
    grid.innerHTML = `<p style="text-align:center; color:#666;">${t('No products found', 'لا توجد منتجات')}</p>`;
    return;
  }

  const selectedStoreId = document.getElementById('pos-warehouse-selector')?.value || localStorage.getItem('pos_selected_store');

  filteredProducts.forEach((product) => {
    let currentStock = product.stock || 0;
    if (product.stores && selectedStoreId) {
        const storeStock = product.stores.find(s => s.storeId.toString() === selectedStoreId.toString());
        currentStock = storeStock ? storeStock.stock : 0;
    }

    const div = document.createElement("div");
    div.className = "product-card";
    if (product.trackStock !== false && currentStock <= 0) div.classList.add("out-of-stock");
    
    // Clicking anywhere on the card adds to cart
    div.onclick = () => addToCart({ ...product, currentStock });
    
    const stockDisplay = (product.trackStock === false) ? '<span style="font-weight: bold; color:#10b981;">∞</span>' : `${t('Stock:', 'المخزون:')} ${currentStock}`;
    
    const imageHtml = product.imageUrl 
      ? `<img src="${product.imageUrl}" alt="${product.name}">`
      : `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 text-slate-400 text-3xl"><i class="fas fa-box text-xl opacity-40"></i></div>`;

    div.innerHTML = `
      <div class="image-wrapper">
        ${imageHtml}
      </div>
      <div class="info">
        <span class="category">${product.category || (lang === 'ar' ? 'عام' : 'General')}</span>
        <h4 class="title">${product.name}</h4>
        <div class="flex justify-between items-center mt-auto">
          <p class="price">$${product.price.toFixed(2)}</p>
          <span class="stock text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100">${stockDisplay}</span>
        </div>
        <button class="add-btn mt-2">${t('Add to Cart', 'إضافة للسلة')}</button>
      </div>
    `;
    grid.appendChild(div);
  });
}

function handleSearch() {
  const query = document.getElementById("productSearch")?.value?.trim().toLowerCase() || "";
  filteredProducts = allProducts.filter(p =>
    (p.name && p.name.toLowerCase().includes(query)) ||
    (p.code && String(p.code).toLowerCase().includes(query)) ||
    (p.barcode && String(p.barcode).toLowerCase().includes(query))
  );
  renderProducts();
}

function searchProductByBarcode(barcode) {
  const found = allProducts.find(p => p.barcode === barcode);
  if (found) {
    addToCart(found);
    return true;
  }
  return false;
}

async function loadSalesmen() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/salesmen`, {
      headers: { 'x-auth-token': token }
    });
    if (response.ok) {
      const salesmen = await response.json();
      const select = document.getElementById("salesmanSelect");
      if (!select) return;
      select.innerHTML = `<option value="">--</option>`;
      salesmen.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.name;
        opt.textContent = s.name;
        select.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error loading salesmen:', error);
  }
}

async function loadCustomers() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/customers`, {
      headers: { 'x-auth-token': token }
    });
    if (response.ok) {
      const customers = await response.json();
      const select = document.getElementById("customerSelect");
      if (!select) return;
      select.innerHTML = `<option value="">--</option>`;
      customers.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name} (Bal: ${c.balance.toFixed(2)})`;
        select.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error loading customers:', error);
  }
}

// ===================== VARIANTS & CART LOGIC =====================
window.closeVariantModal = function() {
    document.getElementById('variantModal').style.display = 'none';
};

window.selectVariant = function(productId, variantSku) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    const variant = product.variants.find(v => v.sku === variantSku || v.barcode === variantSku);
    if (!variant) return;

    closeVariantModal();

    const variantProduct = {
        ...product,
        _id: variant.id, // Treat variant as unique cart item
        productId: product.id, // Keep reference to main product
        name: `${product.name} - ${Object.values(variant.attributes).join(' / ')}`,
        price: variant.price || product.price,
        code: variant.barcode || variant.sku || product.code,
        barcode: variant.barcode || variant.sku || product.barcode,
        stock: variant.stock,
        trackStock: product.trackStock
    };

    addToCartDirect(variantProduct);
};

function addToCart(product) {
  console.log('Adding to cart:', product);

  if (product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0) {
      // Open Variant Modal
      const modal = document.getElementById('variantModal');
      const title = document.getElementById('variantModalTitle');
      const options = document.getElementById('variantOptions');
      
      const lang = localStorage.getItem('pos_language') || 'en';
      const t = (en, ar) => (lang === 'ar' ? ar : en);
      
      title.textContent = `${t('Select Option for', 'اختر خيار لـ')} ${product.name}`;
      options.innerHTML = '';
      
      product.variants.forEach(v => {
          const btn = document.createElement('button');
          btn.className = 'w-full text-left p-4 rounded-xl border border-gray-200 hover:border-brand-blue hover:bg-blue-50 transition-all font-bold';
          btn.innerHTML = `
            <div class="flex justify-between items-center">
                <span>${Object.values(v.attributes).join(' / ')}</span>
                <span class="text-brand-blue">${(v.price || product.price).toFixed(2)}</span>
            </div>
            <div class="text-xs text-gray-500 font-normal mt-1">${t('Stock:', 'المخزون:')} ${v.stock} | ${t('Barcode:', 'الباركود:')} ${v.barcode || v.sku}</div>
          `;
          btn.onclick = () => selectVariant(product.id, v.sku || v.barcode);
          options.appendChild(btn);
      });
      
      modal.style.display = 'flex';
      return;
  }

  addToCartDirect(product);
}

function addToCartDirect(product) {
  // Check stock (if tracked)
  if (product.trackStock !== false && product.stock <= 0) {
    alert("Out of stock!");
    return;
  }

  const existingItem = cart.find(item => item.id === product.id);

  if (existingItem) {
    // Check stock for existing item (if tracked)
    if (product.trackStock !== false && existingItem.qty >= product.stock) {
      alert("Not enough stock!");
      return;
    }
    existingItem.qty++;
  }

  if (!existingItem) {
    cart.push({
      ...product,
      basePrice: product.price,
      qty: 1,
      // Timer Properties
      accumulatedTime: 0, // In ms
      lastStartTime: null, // timestamp when started
      isRunning: false
    });
  }

  // Initialize start time if this is the first item
  if (!transactionStartTime) {
    transactionStartTime = Date.now();
    console.log('Transaction started at:', new Date(transactionStartTime).toLocaleTimeString());
  }

  console.log('Cart updated:', cart);
  updateCartSummary();
}

function updateCartSummary() {
  const cartItemsContainer = document.getElementById("cartItems");
  const cartCounter = document.getElementById("cartCounter");
  const cartSubtotal = document.getElementById("cartSubtotal");
  const cartTotal = document.getElementById("cartTotal");
  const cartEmptyText = document.getElementById("cartEmptyText");

  // Load Tax Settings
  const taxName = localStorage.getItem('taxName') || 'Tax';
  const taxRate = parseFloat(localStorage.getItem('taxRate') || 0);

  if (!cartItemsContainer) return;

  cartItemsContainer.innerHTML = "";
  let subtotal = 0;

  if (cart.length === 0) {
    cartEmptyText.style.display = "block";
    if (cartCounter) cartCounter.textContent = "0";
    if (cartSubtotal) cartSubtotal.textContent = "0.00 ج.م";
    if (cartTax) {
      cartTax.textContent = "0.00 ج.م";
      const taxLabel = document.getElementById('taxLabel');
      if (taxLabel) taxLabel.textContent = `${taxName} (${taxRate}%):`;
    }
    if (cartTotal) cartTotal.textContent = "Total: 0.00 ج.م";
    disableActionButtons(true);
    return;
  }

  cartEmptyText.style.display = "none";
  disableActionButtons(false);
  document.getElementById('splitBtn').disabled = false; // Enable Split Button logic

  const orderType = document.getElementById('orderTypeSelect')?.value || 'instore';

  cart.forEach((item, index) => {
    let activePrice = item.basePrice || item.price;
    if (orderType === 'online' && item.priceOnline > 0) activePrice = item.priceOnline;
    if (orderType === 'delivery' && item.priceDelivery > 0) activePrice = item.priceDelivery;
    item.price = activePrice;

    subtotal += item.price * item.qty;
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <div>
        <strong>${item.name}</strong><br>
        <div style="display:flex;align-items:center;">
           <small>${item.price.toFixed(2)} x <span onclick="editCartItemQty(${index})" style="cursor:pointer;border-bottom:1px dashed #333;font-weight:bold;" title="Click to edit quantity">${item.qty.toFixed(2)}</span></small>
           
           <div class="timer-controls">
             <button class="timer-btn ${item.isRunning ? 'stop' : 'start'}" onclick="toggleItemTimer(${index})">
               ${item.isRunning ? '⏹ Stop' : '▶ Start'}
             </button>
             <span class="timer-display" id="timer-${index}">
               ${formatDuration(item.accumulatedTime + (item.isRunning ? (Date.now() - item.lastStartTime) : 0))}
             </span>
           </div>
        </div>
      </div>
      <div>
        <span>${(item.price * item.qty).toFixed(2)}</span>
        <button onclick="removeFromCart(${index})" class="btn-danger" style="padding:2px 6px;margin-left:5px;">x</button>
      </div>
    `;
    cartItemsContainer.appendChild(div);
  });

  let discountAmount = 0;
  if (window.cartDiscount) {
    if (window.cartDiscount.type === 'percent') {
      discountAmount = subtotal * (window.cartDiscount.value / 100);
    } else if (window.cartDiscount.type === 'value') {
      discountAmount = window.cartDiscount.value;
    }
  }

  let discountedSubtotal = subtotal - discountAmount;
  if (discountedSubtotal < 0) discountedSubtotal = 0;

  // LOAD SETTINGS
  const taxLabel = document.getElementById('taxLabel');

  // Default applyTax to true if not set OR simply force it for the 'default checked' requirement
  // User requested "by default checked", implying on every session start/reload it should be checked.
  localStorage.setItem('applyTax', 'true');
  let applyTaxStored = 'true';

  // FIXED: Correct ID 'taxCheckbox' matched with HTML
  const applyTaxCheckbox = document.getElementById('taxCheckbox');
  let taxAmount = 0;

  if (taxLabel) {
    taxLabel.textContent = `${taxName} (${taxRate}%)`;
  }

  if (applyTaxCheckbox) {
    applyTaxCheckbox.checked = true; // Always check on load
    applyTaxCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('applyTax', e.target.checked);
      updateCartSummary();
    });
  }

  if (applyTaxCheckbox && applyTaxCheckbox.checked && taxRate > 0) {
    taxAmount = discountedSubtotal * (taxRate / 100);
    localStorage.setItem('applyTax', 'true');
  } else if (applyTaxCheckbox && !applyTaxCheckbox.checked) {
    localStorage.setItem('applyTax', 'false');
  } else if (applyTaxCheckbox && applyTaxCheckbox.checked && taxRate === 0) {
    localStorage.setItem('applyTax', 'true');
  }

  const finalTotal = discountedSubtotal + taxAmount;

  if (cartCounter) cartCounter.textContent = cart.length;
  if (cartSubtotal) cartSubtotal.textContent = `${subtotal.toFixed(2)} ج.م`;

  const discountEl = document.getElementById("cartDiscount");
  if (discountEl) discountEl.textContent = `${discountAmount.toFixed(2)} ج.م`;

  if (cartTax) {
    cartTax.textContent = taxAmount.toFixed(2) + " ج.م";
    // Redundant label update removed, handled above
  }
  if (cartTotal) cartTotal.textContent = "Total: " + finalTotal.toFixed(2) + " ج.م";

  // Persist for processing
  window.currentTransactionTax = taxAmount;
  window.currentTransactionTotal = finalTotal;
}

function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartSummary();
}

function clearCart() {
  cart = [];
  transactionStartTime = null; // Reset time
  window.currentHeldOrderId = null; // Clear held order tracking
  window.currentHeldOrderName = null;
  window.cartDiscount = null; // Clear discount when cart is cleared
  const taxCheckbox = document.getElementById('taxCheckbox');
  if (taxCheckbox) taxCheckbox.checked = false; // Reset tax checkbox
  localStorage.setItem('applyTax', 'false'); // Ensure tax is not applied by default
  updateCartSummary();
}

function editCartItemQty(index) {
  const item = cart[index];
  if (!item) return;

  const input = prompt(`Enter new quantity for ${item.name}:`, item.qty);
  if (input === null) return; // Cancelled

  const newQty = parseFloat(input);

  if (isNaN(newQty) || newQty <= 0) {
    alert("Invalid quantity!");
    return;
  }

  // Check stock if tracked
  if (item.trackStock !== false && newQty > item.stock) {
    alert(`Not enough stock! Available: ${item.stock}`);
    return;
  }

  item.qty = newQty;
  updateCartSummary();
}

function disableActionButtons(disabled) {
  ["cashBtn", "cardBtn", "mobileBtn", "holdBtn", "clearCartBtn"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// ===================== DISCOUNT LOGIC =====================
function openDiscountModal() {
  const modal = document.getElementById("discountModal");
  if (modal) {
    modal.style.display = "flex";
    // Reset fields
    document.getElementById("discountType").value = "none";
    document.getElementById("discountValue").value = "";
    const pwGroup = document.getElementById("discountPasswordGroup");
    if (pwGroup) pwGroup.style.display = "none";
    const pwInput = document.getElementById("discountManagerPassword");
    if (pwInput) pwInput.value = "";
  }
}

function closeDiscountModal() {
  const modal = document.getElementById("discountModal");
  if (modal) modal.style.display = "none";
}

async function saveDiscount() {
  const type = document.getElementById("discountType").value;
  const value = parseFloat(document.getElementById("discountValue").value) || 0;
  const lang = localStorage.getItem('pos_language') || 'en';

  if (type !== 'none' && value > 0) {
    const password = document.getElementById("discountManagerPassword").value;
    if (!password) {
      alert(lang === 'ar' ? "مطلوب كلمة مرور المدير لتطبيق الخصم!" : "Manager password is required to apply discount!");
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/verify-manager-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        alert(errData.msg || (lang === 'ar' ? "كلمة مرور المدير غير صحيحة!" : "Incorrect manager password!"));
        return;
      }
    } catch (err) {
      console.error(err);
      alert(lang === 'ar' ? "خطأ في الاتصال بالخادم" : "Connection error");
      return;
    }
  }

  // Apply discount to the entire cart (simple implementation)
  // In a more complex system, we might apply per item or to subtotal
  // Here we will just store it globally or apply to subtotal for display

  // For this implementation, let's apply it as a global discount on the cart total
  // We need to store this discount state
  window.cartDiscount = { type, value };

  updateCartSummary();
  closeDiscountModal();
}

// ===================== SALE PROCESSING =====================
async function processSale(method) {
  if (isReadOnly) {
    alert("Read-Only Mode: Transactions are disabled.");
    return;
  }
  if (cart.length === 0) return;

  // Fix: Define translation helper function
  const lang = localStorage.getItem('pos_language') || 'en';
  const t = (en, ar) => (lang === 'ar' ? ar : en);

  const salesmanSelect = document.getElementById("salesmanSelect");
  const salesmanName = salesmanSelect ? salesmanSelect.value : "";

  // Use the pre-calculated total and tax from updateCartSummary
  const finalTotal = window.currentTransactionTotal || 0;
  const taxAmount = window.currentTransactionTax || 0;

  // Recalculate subtotal and discount for saleData structure
  let subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  let discountAmount = 0;
  if (window.cartDiscount) {
    if (window.cartDiscount.type === 'percent') {
      discountAmount = subtotal * (window.cartDiscount.value / 100);
    } else if (window.cartDiscount.type === 'value') {
      discountAmount = window.cartDiscount.value;
    }
  }

  // Determine tax settings for snapshot
  const currentTaxName = localStorage.getItem('taxName') || 'Tax';
  const currentTaxRate = parseFloat(localStorage.getItem('taxRate') || 0);

  const saleData = {
    items: cart.map(item => ({
      code: item.code,
      name: item.name,
      qty: item.qty,
      price: item.price,
      cost: item.cost,
      total: item.price * item.qty,
      code: item.barcode
    })),
    subtotal: subtotal,
    discount: window.cartDiscount,
    discountAmount: discountAmount,
    taxAmount: taxAmount,
    taxName: currentTaxName,
    taxRate: currentTaxRate,
    total: finalTotal,
    paymentMethod: method,
    orderType: document.getElementById('orderTypeSelect')?.value || 'instore',
    splitPayments: window.currentSplitPayments || [], // Send split details if any
    salesman: salesmanName,
    date: new Date()
  };

  if (method === 'credit') {
    const customerSelect = document.getElementById("customerSelect");
    if (!customerSelect || !customerSelect.value) {
      alert(t("Please select a customer for credit sale", "الرجاء اختيار عميل للبيع بالآجل"));
      return;
    }
    saleData.customerId = customerSelect.value;
  }

  showLoading();

  const payButton = document.getElementById('payButton');
  if (payButton) payButton.disabled = true;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify(saleData)
    });

    if (response.ok) {
      const result = await response.json();

      // Fix: Use printReceipt instead of undefined generateReceiptHTML
      // Check if we have settings in result, pass them
      await printReceipt(result.sale, result.settings);

      clearCart();
      alert(t("Sale processed successfully!", "تمت العملية بنجاح!"));
    } else {
      // Check for 401 Unauthorized (Session Expired)
      if (response.status === 401) {
        if (cart.length > 0) {
          // AUTO-HOLD LOGIC
          const autoHoldName = `Auto-Save ${new Date().toLocaleTimeString()}`;
          const heldOrder = {
            id: Date.now(),
            name: autoHoldName,
            timestamp: Date.now(),
            startTime: transactionStartTime || Date.now(),
            cart: [...cart],
            salesman: document.getElementById('salesmanSelect')?.value || ''
          };

          // Get existing held orders
          let localHeld = [];
          try {
            localHeld = JSON.parse(localStorage.getItem('heldTransactions')) || [];
          } catch (e) { localHeld = []; }

          localHeld.push(heldOrder);
          localStorage.setItem('heldTransactions', JSON.stringify(localHeld));

          alert(t(
            "Session expired! Your order has been auto-saved as '" + autoHoldName + "'. check Held Orders after login.",
            "انتهت الجلسة! تم حفظ الطلب تلقائيًا باسم '" + autoHoldName + "'. تحقق من الطلبات المعلقة بعد تسجيل الدخول."
          ));
        } else {
          alert(t("Session expired. Please login again.", "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى."));
        }

        window.location.href = 'index.html'; // Redirect to login
        return;
      }

      const errData = await response.json();
      alert(`${t("Failed to process sale", "فشل العملية")}: ${errData.msg || 'Error'}`);
    }
  } catch (error) {
    console.error('Error processing sale:', error);
    alert(t("Error processing sale", "حدث خطأ أثناء المعالجة"));
  } finally {
    if (payButton) payButton.disabled = false;
    hideLoading();
  }

}

async function printDailySummary(data) {
  try {
    const shopName = localStorage.getItem('shopName') || 'My Shop';
    const lang = localStorage.getItem('pos_language') || 'en';
    const t = (en, ar) => (lang === 'ar' ? ar : en);
    const dateFormatted = new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    const html = `
      <html>
      <head>
        <title>${t("Daily Summary", "ملخص اليوم")}</title>
        <style>
          body { font-family: Arial, sans-serif; direction: ${lang === 'ar' ? 'rtl' : 'ltr'}; text-align: center; }
          .container { width: 72mm; margin: 0 auto; }
          h2 { margin: 5px 0; }
          .summary-item { display: flex; justify-content: space-between; margin: 5px 0; font-weight: bold; }
          hr { border-top: 1px dashed #000; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>${shopName}</h2>
          <h3>${t("Daily Summary", "ملخص اليومية")}</h3>
          <p>${dateFormatted}</p>
          <hr/>
          <div class="summary-item">
            <span>${t("Total Orders", "عدد الطلبات")}</span>
            <span>${data.totalOrders}</span>
          </div>
          <div class="summary-item">
            <span>${t("Total Sales", "إجمالي المبيعات")}</span>
            <span>${data.totalSales.toFixed(2)}</span>
          </div>
          <hr/>
          <p>${t("Printed at", "طبع في")}: ${new Date().toLocaleTimeString()}</p>
        </div>
      </body>
      </html>
    `;

    window.printContent(html);

  } catch (error) {
    console.error('Error printing daily summary:', error);
    alert('Failed to print daily summary');
  }
}

async function loadSettings() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/settings`, {
      headers: { 'x-auth-token': token }
    });
    if (response.ok) {
      const settings = await response.json();
      // Save settings to localStorage for easy access
      if (settings.shopName) localStorage.setItem('shopName', settings.shopName);
      if (settings.shopAddress) localStorage.setItem('shopAddress', settings.shopAddress);
      if (settings.shopLogo) localStorage.setItem('shopLogo', settings.shopLogo);
      if (settings.footerMessage) localStorage.setItem('footerMessage', settings.footerMessage);
      if (settings.taxRate !== undefined) localStorage.setItem('taxRate', settings.taxRate);
      if (settings.taxName) localStorage.setItem('taxName', settings.taxName);
      if (settings.applyTax !== undefined) {
        localStorage.setItem('applyTax', settings.applyTax ? 'true' : 'false');
        const taxCheckbox = document.getElementById('taxCheckbox');
        if (taxCheckbox) taxCheckbox.checked = settings.applyTax;
      }

      if (settings.applyTax === undefined && localStorage.getItem('applyTax') === null) {
        // Default to TRUE if not set
        localStorage.setItem('applyTax', 'true');
        const taxCheckbox = document.getElementById('taxCheckbox');
        if (taxCheckbox) taxCheckbox.checked = true;
      }

      // Refresh cart to apply new settings (tax rate, name, etc.)
      updateCartSummary();
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkTrialStatus();
  checkOpenShift();
  loadProducts();
  loadCategories();
  loadSalesmen();
  loadCustomers();

  loadHeldTransactions();

  // Discount password toggle listener
  document.getElementById('discountType')?.addEventListener('change', (e) => {
    const pwGroup = document.getElementById('discountPasswordGroup');
    if (pwGroup) {
      pwGroup.style.display = e.target.value === 'none' ? 'none' : 'block';
    }
  });

  // Event Listeners
  document.getElementById('productSearch')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    filteredProducts = allProducts.filter(p =>
      p.name.toLowerCase().includes(term) ||
      (p.barcode && p.barcode.includes(term))
    );
    renderProducts(filteredProducts);
  });

  // Grid Zoom Slider
  document.getElementById('gridZoom')?.addEventListener('input', (e) => {
    const val = e.target.value;
    document.documentElement.style.setProperty('--card-width', `${val}px`);
  });



  document.getElementById('payButton')?.addEventListener('click', processSale);
  document.getElementById('holdButton')?.addEventListener('click', holdTransaction);
  document.getElementById('discountButton')?.addEventListener('click', openDiscountModal);
  document.getElementById('taxCheckbox')?.addEventListener('change', updateCartSummary);


  // Shift Modals
  document.getElementById('confirmOpenShift')?.addEventListener('click', submitOpenShift);
  document.getElementById('confirmCloseShift')?.addEventListener('click', submitCloseShift);
  document.getElementById('closeShiftBtn')?.addEventListener('click', closeShift);

  // Language
  const lang = localStorage.getItem('pos_language') || 'en';
  if (window.applyTranslations) window.applyTranslations();
});

async function printReceipt(receipt, providedSettings = null) {
  try {
    // If passed an ID instead of object, fetch it (just in case)  
    if (typeof receipt === 'string') {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/sales/${receipt}`, {
        headers: { 'x-auth-token': token }
      });
      if (!response.ok) {
        alert('Failed to load receipt for printing');
        return;
      }
      receipt = await response.json();
    }

    const getSetting = (key, defaultVal = '') => {
      if (providedSettings && providedSettings[key] !== undefined) return providedSettings[key];
      return localStorage.getItem(key) || defaultVal;
    };

    const shopName = getSetting('shopName', 'My Shop');
    const shopAddress = getSetting('shopAddress');
    const shopLogo = getSetting('shopLogo');
    const receiptFooterMessage = getSetting('footerMessage');
    const taxRate = parseFloat(getSetting('taxRate', 0));
    const taxName = getSetting('taxName', 'Tax');
    // Default applyTax to true if missing
    let applyTaxVal = getSetting('applyTax');
    if (applyTaxVal === '') applyTaxVal = 'true';
    const applyTax = applyTaxVal === 'true';


    const lang = localStorage.getItem('pos_language') || 'en';
    const t = (en, ar) => (lang === 'ar' ? ar : en);
    const paymentMap = {
      cash: t("Cash", "نقدي"),
      card: t("Card", "بطاقة"),
      mobile: t("Mobile", "محفظة"),
      split: t("Split", "تقسيم")
    };

    let totalDiscount = receipt.discountAmount || 0;
    let subtotal = receipt.subtotal || receipt.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    let taxAmount = receipt.taxAmount || 0;

    // Fallback: If taxAmount is missing but we have a rate, calculate it
    if (!taxAmount && taxRate > 0) {
      const discountedSub = Math.max(0, subtotal - totalDiscount);
      taxAmount = discountedSub * (taxRate / 100);
    }

    const itemsHtml = receipt.items.map(item => {
      const originalTotal = item.price * item.qty;
      let discountStr = "-";
      let discountAmountPerUnit = 0;

      if (item.discount?.type === "percent") {
        discountAmountPerUnit = item.price * (item.discount.value / 100);
        discountStr = `${item.discount.value}%`;
      } else if (item.discount?.type === "value") {
        discountAmountPerUnit = item.discount.value;
        discountStr = `${discountAmountPerUnit.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`;
      }

      // totalDiscount is now taken from receipt.discountAmount, so no need to sum here
      // subtotal is also taken from receipt.subtotal
      // itemDiscountTotal is not used for overall totalDiscount calculation anymore

      return `  
                 <tr>  
                     <td>${item.code || '-'}</td>  
                     <td>${item.name || '-'}</td>  
                     <td>${item.qty}</td>  
                     <td>${item.price.toFixed(2)}</td>  
                     <td>${originalTotal.toFixed(2)}</td>  
                     <td>${discountStr}</td>  
                 </tr>  
             `;
    }).join('');

    const dateFormatted = new Date(receipt.date).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Generate Tax Line for Summary if applicable
    let taxSummaryHtml = '';
    if (taxAmount > 0) {
      const taxLabel = `${taxName} (${taxRate}%)`;
      taxSummaryHtml = `<p>${taxLabel}: ${taxAmount.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>`;
    }

    // Content inside the receipt container
    const receiptContent = `
        ${shopLogo ? `<img src="${shopLogo}" class="logo">` : ''}  
        <h2 class="center">${shopName}</h2>  
        <p class="center">${shopAddress}</p>  
        <hr/>  
        <p>${t("Receipt No", "رقم الفاتورة")}: ${receipt.receiptId}</p>  
        <p>${t("Cashier", "الكاشير")}: ${receipt.cashier}</p>  
        <p>${t("Salesman", "البائع")}: ${receipt.salesman || '-'}</p>  
        <p>${t("Date", "التاريخ")}: ${dateFormatted}</p>  
        <p>${t("Payment Method", "طريقة الدفع")}: ${paymentMap[receipt.paymentMethod] || '-'}</p>  
        ${receipt.paymentMethod === 'split' && receipt.splitPayments ?
        receipt.splitPayments.map(p => `<p style="font-size:0.8em; margin-left:10px;">- ${paymentMap[p.method]}: ${p.amount.toFixed(2)}</p>`).join('')
        : ''}
        <table>    
            <thead>  
                <tr>  
                    <th>${t("Code", "كود")}</th>  
                    <th>${t("Name", "الاسم")}</th>  
                    <th>${t("Qty", "كمية")}</th>  
                    <th>${t("Unit Price", "سعر")}</th>  
                    <th>${t("Total", "الإجمالي")}</th>  
                    <th>${t("Discount", "الخصم")}</th>  
                </tr>  
            </thead>  
            <tbody>
                ${itemsHtml}
            </tbody>  
        </table>  
        <div class="summary">  
            <p>${t("Subtotal", "المجموع الفرعي")}: ${subtotal.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>  
            <p>${t("Total Discount", "إجمالي الخصم")}: ${totalDiscount.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>  
            ${taxSummaryHtml}
            <p style="font-size: 1.1em; border-top: 1px dashed #444; margin-top:5px; padding-top:5px;">${t("Total", "الإجمالي النهائي")}: ${receipt.total.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>  
        </div>    
        <hr/>  
        ${receiptFooterMessage ? `<p class="footer" style="font-size:13px; font-weight: bold;">${receiptFooterMessage}</p>` : ''}  
        <p class="footer">  
            <strong>Tashgheel POS &copy; 2025</strong><br>  
            📞 <a href="tel:+201126522373">01126522373</a> / <a href="tel:+201155253886">01155253886</a><br>  
            <span id="footerText">${t("Designed and developed by Itqan", "تم التطوير بواسطة Itqan")}</span>  
        </p>  
    `;

    const html = `  
             <html>  
             <head>  
                 <title>${t("Receipt", "فاتورة")}</title>  
                 <style>  
                     body { font-family: Arial, sans-serif; font-size: 11.5px; font-weight: bold; line-height: 1.7; direction: ${lang === 'ar' ? 'rtl' : 'ltr'}; margin: 0; padding: 0; }  
                     .receipt-container { width: 72mm; margin: 0; padding: 5px 0; background: #fff; box-sizing: border-box; }  
                     .center { text-align: center; }  
                     img.logo { max-height: 70px; display: block; margin: 0 auto 5px; }  
                     h2 { margin: 3px 0; font-size: 15px; font-weight: bold; width: 100%; word-wrap: break-word; }  
                     p { margin: 2px 8px; font-weight: bold; }  
                     table { width: 98%; border-collapse: collapse; margin: 8px auto 4px; table-layout: fixed; }  
                     th, td { border: 1px dashed #444; padding: 4px 5px; text-align: center; font-size: 11px; white-space: normal; word-break: break-word; font-weight: bold; }  
                     th:nth-child(1), td:nth-child(1) { width: 14%; }  
                     th:nth-child(2), td:nth-child(2) { width: 28%; }  
                     th:nth-child(3), td:nth-child(3) { width: 10%; }  
                     th:nth-child(4), td:nth-child(4) { width: 14%; }  
                     th:nth-child(5), td:nth-child(5) { width: 16%; }  
                     th:nth-child(6), td:nth-child(6) { width: 18%; }  
                     .summary { margin: 10px 8px 0; font-size: 12px; font-weight: bold; }  
                     .footer { text-align: center; margin: 12px 0 0; font-size: 10.5px; border-top: 1px dashed #ccc; padding-top: 6px; font-weight: bold; }  
                     
                     @media print { 
                        @page { size: 72mm auto; margin: 0; } 
                        body { margin: 0; padding: 0; } 
                        .page-break { page-break-after: always; display: block; height: 1px; }
                     }  
                 </style>  
             </head>  
             <body>  
                 <div class="receipt-container">  
                    ${receiptContent}
                 </div>

             </body>  
             </html>  
         `;


    window.printContent(html);

  } catch (error) {
    console.error('Error printing receipt:', error);
    alert('Failed to print receipt');
  }
}

// Categories  
async function loadCategories() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/categories`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) throw new Error('Failed to fetch categories');
    const categories = await response.json();
    renderCategories(categories);
  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

function renderCategories(categories) {
  const container = document.getElementById('categoryContainer');
  if (!container) return;

  const existingButtons = container.querySelectorAll('button:not([data-id="all"])');
  existingButtons.forEach(btn => btn.remove());

  const iconMap = {
    'electronics': 'fa-laptop',
    'apparel': 'fa-tshirt',
    'groceries': 'fa-basket-shopping',
    'sales': 'fa-tags',
    'reports': 'fa-chart-simple',
    'indicators': 'fa-chart-pie',
    'shipping': 'fa-truck',
    'clothing': 'fa-tshirt',
    'food': 'fa-utensils',
    'الكترونيات': 'fa-laptop',
    'ملابس': 'fa-tshirt',
    'بقالة': 'fa-basket-shopping',
    'مبيعات': 'fa-tags',
    'تقارير': 'fa-chart-simple',
    'مؤشرات': 'fa-chart-pie',
    'شحن': 'fa-truck'
  };

  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.dataset.id = cat.name;

    const nameLower = cat.name.toLowerCase();
    const nameEnLower = (cat.nameEn || '').toLowerCase();
    const iconClass = iconMap[nameLower] || iconMap[nameEnLower] || 'fa-tag';

    const lang = localStorage.getItem('pos_language') || 'en';
    const displayName = lang === 'ar' ? cat.name : (cat.nameEn || cat.name);

    btn.innerHTML = `
      <i class="fas ${iconClass} text-xl mb-2"></i>
      <span>${displayName}</span>
    `;

    btn.onclick = () => filterProducts(cat.name, btn);
    container.appendChild(btn);
  });
}

function filterProducts(categoryName, btnClicked) {
  const buttons = document.querySelectorAll('.category-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
  });

  if (btnClicked) {
    btnClicked.classList.add('active');
    btnClicked.classList.remove('btn-secondary');
    btnClicked.classList.add('btn-primary');
  } else {
    // Try to find button by name if passed manually
    const targetBtn = document.querySelector(`.category-btn[data-id="${categoryName}"]`);
    if (targetBtn) {
      targetBtn.classList.add('active');
      targetBtn.classList.remove('btn-secondary');
      targetBtn.classList.add('btn-primary');
    } else {
      // Fallback for 'all'
      const allBtn = document.querySelector('.category-btn[data-id="all"]');
      if (allBtn && categoryName === 'all') {
        allBtn.classList.add('active');
        allBtn.classList.remove('btn-secondary');
        allBtn.classList.add('btn-primary');
      }
    }
  }

  const searchInput = document.getElementById('productSearch');
  if (searchInput) searchInput.value = '';

  if (categoryName === 'all') {
    filteredProducts = allProducts;
  } else {
    filteredProducts = allProducts.filter(p => p.category === categoryName);
  }

  renderProducts();
}

window.filterProducts = filterProducts;
window.processSale = processSale;
window.closeShift = closeShift;
window.submitOpenShift = submitOpenShift;
window.submitCloseShift = submitCloseShift;
function scanBarcode() {
  const searchTerm = prompt("Scan or enter barcode:");
  if (searchTerm) {
    const input = document.getElementById("productSearch");
    if (input) {
      input.value = searchTerm;
      input.dispatchEvent(new Event('input'));
    }
  }
}

window.scanBarcode = scanBarcode;
window.clearCart = clearCart;
// ===================== HELD & LAYAWAY ORDERS LOGIC =====================

function switchPosTab(tab) {
  const productGrid = document.getElementById('productGrid');
  const heldGrid = document.getElementById('heldOrdersGrid');
  const catContainer = document.getElementById('categoryContainer');
  const tabProducts = document.getElementById('tabProducts');
  const tabHeld = document.getElementById('tabHeld');

  if (!productGrid || !heldGrid || !catContainer || !tabProducts || !tabHeld) return;

  if (tab === 'products') {
    productGrid.style.display = 'grid';
    heldGrid.style.display = 'none';
    catContainer.style.display = 'flex';

    tabProducts.classList.add('btn-primary');
    tabProducts.classList.remove('btn-secondary');
    tabHeld.classList.remove('btn-primary');
    tabHeld.classList.add('btn-secondary');
  } else {
    productGrid.style.display = 'none';
    heldGrid.style.display = 'grid';
    catContainer.style.display = 'none';

    tabProducts.classList.remove('btn-primary');
    tabProducts.classList.add('btn-secondary');
    tabHeld.classList.add('btn-primary');
    tabHeld.classList.remove('btn-secondary');
    loadHeldTransactions();
  }
}

function updateHeldCount() {
  const badge = document.getElementById('heldCountBadge');
  if (!badge) return;
  if (heldTransactions.length > 0) {
    badge.textContent = heldTransactions.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function loadHeldTransactions() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/suspended-invoices`, {
      headers: { 'x-auth-token': token }
    });
    if (response.ok) {
      heldTransactions = await response.json();
      updateHeldCount();
      renderHeldOrders();
      startHeldOrdersTimer();
    }
  } catch (err) {
    console.error("Error loading suspended invoices:", err);
  }
}

async function holdTransaction() {
  if (cart.length === 0) return alert("Cart is empty!");

  const lang = localStorage.getItem('pos_language') || 'en';
  const namePrompt = lang === 'ar' ? "أدخل اسماً أو ملاحظة لهذا الطلب المعلق:" : "Enter a name or note for this held transaction:";
  const notes = prompt(namePrompt) || "";

  const storeId = localStorage.getItem('pos_selected_store');
  const user = JSON.parse(localStorage.getItem('currentUser'));
  const cashier = user ? user.username : 'cashier';
  const customerSelect = document.getElementById("customerSelect");
  const customerId = customerSelect ? customerSelect.value : null;
  const salesmanSelect = document.getElementById("salesmanSelect");
  const salesman = salesmanSelect ? salesmanSelect.value : null;

  let discount = null;
  if (window.cartDiscount) {
    discount = window.cartDiscount;
  }

  const suspendedData = {
    storeId,
    cashier,
    customerId,
    items: cart.map(item => ({
      code: item.code,
      name: item.name,
      qty: item.qty,
      price: item.price,
      cost: item.cost,
      barcode: item.barcode || item.code,
      trackStock: item.trackStock !== undefined ? item.trackStock : true,
      category: item.category,
      imageUrl: item.imageUrl,
      stores: item.stores || [],
      hasVariants: item.hasVariants || false,
      variantName: item.variantName || null
    })),
    discount,
    salesman,
    notes
  };

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/suspended-invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify(suspendedData)
    });

    if (response.ok) {
      clearCart();
      alert(lang === 'ar' ? "تم تعليق الفاتورة بنجاح!" : "Transaction suspended successfully!");
      await loadHeldTransactions();
      switchPosTab('products');
    } else {
      const errData = await response.json();
      alert((lang === 'ar' ? "فشل تعليق الفاتورة: " : "Failed to suspend transaction: ") + (errData.msg || ''));
    }
  } catch (err) {
    console.error(err);
    alert("Connection error");
  }
}

function startHeldOrdersTimer() {
  if (heldOrdersInterval) clearInterval(heldOrdersInterval);
  heldOrdersInterval = setInterval(() => {
    const timerElements = document.querySelectorAll('.held-timer');
    timerElements.forEach(el => {
      const timestamp = parseInt(el.dataset.timestamp);
      el.textContent = getHeldDuration(timestamp);
    });
  }, 60000); // Update every minute
}

function getHeldDuration(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const lang = localStorage.getItem('pos_language') || 'en';
  const heldFor = lang === 'ar' ? 'معلق منذ:' : 'Held for:';
  return `${heldFor} ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function renderHeldOrders() {
  const grid = document.getElementById('heldOrdersGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const lang = localStorage.getItem('pos_language') || 'en';
  const t = {
    resume: lang === 'ar' ? 'استكمال' : 'Resume',
    discard: lang === 'ar' ? 'حذف' : 'Discard',
    items: lang === 'ar' ? 'أصناف' : 'Items',
    total: lang === 'ar' ? 'إجمالي' : 'Total'
  };

  if (heldTransactions.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #666; padding: 20px;">
            ${lang === 'ar' ? 'لا توجد طلبات معلقة' : 'No held orders active'}
        </div>`;
    return;
  }

  heldTransactions.forEach(order => {
    const itemsArray = Array.isArray(order.items) ? order.items : [];
    const total = itemsArray.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const card = document.createElement('div');
    card.className = 'product-card';
    card.style.cursor = 'default';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'space-between';

    card.innerHTML = `
            <div style="padding:10px;">
                <h4 style="margin:0">${order.notes ? order.notes : '#' + String(order.id).slice(-4)}</h4>
                <p style="color:#555;font-size:0.9em;">${itemsArray.length} ${t.items}</p>
                <p style="font-weight:bold;margin-top:5px;">${total.toFixed(2)}</p>
                <p class="held-timer" data-timestamp="${new Date(order.createdAt).getTime()}" style="color:red;font-size:0.8em;margin-top:5px;">
                    ${getHeldDuration(new Date(order.createdAt).getTime())}
                </p>
                ${order.salesman ? `<p style="font-size:0.8em;color:#666">👤 ${order.salesman}</p>` : ''}
                <p style="font-size:0.75rem;color:#888;margin-top:5px;">Cashier: ${order.cashier}</p>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;">
                <button onclick="resumeHeldOrder('${order.id}')" class="btn btn-success" style="font-size:0.8em">${t.resume}</button>
                <button onclick="discardHeldOrder('${order.id}')" class="btn btn-danger" style="font-size:0.8em">${t.discard}</button>
            </div>
        `;
    grid.appendChild(card);
  });
}

async function resumeHeldOrder(id) {
  if (cart.length > 0) {
    const lang = localStorage.getItem('pos_language') || 'en';
    const msg = lang === 'ar' ? 'السلة ليست فارغة. هل تريد استبدالها؟' : 'Cart is not empty. Replace it?';
    if (!confirm(msg)) return;
  }

  const order = heldTransactions.find(o => o.id === id);
  if (!order) return;

  cart = Array.isArray(order.items) ? order.items.map(item => ({
    code: item.code,
    name: item.name,
    qty: item.qty,
    price: item.price,
    cost: item.cost,
    barcode: item.barcode || item.code,
    trackStock: item.trackStock !== undefined ? item.trackStock : true,
    category: item.category,
    imageUrl: item.imageUrl,
    stores: item.stores || [],
    hasVariants: item.hasVariants || false,
    variantName: item.variantName || null
  })) : [];

  window.cart = cart;

  if (order.customerId) {
    const customerSelect = document.getElementById("customerSelect");
    if (customerSelect) customerSelect.value = order.customerId;
  }

  if (order.salesman) {
    const salesmanSelect = document.getElementById("salesmanSelect");
    if (salesmanSelect) salesmanSelect.value = order.salesman;
  }

  if (order.discount) {
    window.cartDiscount = order.discount;
  } else {
    window.cartDiscount = null;
  }

  try {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/suspended-invoices/${id}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': token }
    });
  } catch (err) {
    console.error("Error deleting suspended invoice upon resume:", err);
  }

  await loadHeldTransactions();
  updateCartSummary();
  switchPosTab('products');
}

async function discardHeldOrder(id) {
  const lang = localStorage.getItem('pos_language') || 'en';
  if (!confirm(lang === 'ar' ? 'تأكيد الحذف؟' : 'Confirm discard?')) return;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/suspended-invoices/${id}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': token }
    });
    if (response.ok) {
      await loadHeldTransactions();
    } else {
      alert("Failed to delete suspended invoice");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error");
  }
}

async function createLayawayFromPOS() {
  if (cart.length === 0) return alert("Cart is empty!");
  
  const lang = localStorage.getItem('pos_language') || 'en';
  const customerId = document.getElementById("customerSelect").value;
  if (!customerId) {
    alert(lang === 'ar' ? "يرجى اختيار عميل للطلب المعلق!" : "Please select a customer for the layaway order!");
    return;
  }

  const namePrompt = lang === 'ar' ? "أدخل ملاحظات لهذا الطلب (اختياري):" : "Enter notes for this layaway order (optional):";
  const notes = prompt(namePrompt) || "";

  const storeId = localStorage.getItem('pos_selected_store');
  const body = {
    customerId,
    storeId,
    notes,
    items: cart.map(item => ({
      productId: item.id,
      code: item.barcode || item.code,
      name: item.name,
      qty: item.qty,
      price: item.price,
      cost: item.cost
    }))
  };

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/open-orders', {
      method: 'POST',
      headers: {
        'x-auth-token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      clearCart();
      alert(lang === 'ar' ? "تم حفظ طلب الحجز/الآجل بنجاح!" : "Layaway order saved successfully!");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.msg || (lang === 'ar' ? "فشل حفظ الطلب" : "Failed to save layaway order"));
    }
  } catch (err) {
    console.error(err);
    alert("Connection error");
  }
}

window.switchPosTab = switchPosTab;
window.resumeHeldOrder = resumeHeldOrder;
window.discardHeldOrder = discardHeldOrder;
window.holdTransaction = holdTransaction;
window.openDiscountModal = openDiscountModal;
window.saveDiscount = saveDiscount;
window.editCartItemQty = editCartItemQty;
window.closeDiscountModal = closeDiscountModal;
window.openSplitPaymentModal = openSplitPaymentModal;
window.updateSplitCalculations = updateSplitCalculations;
window.confirmSplitPayment = confirmSplitPayment;
window.createLayawayFromPOS = createLayawayFromPOS;
window.loadHeldTransactions = loadHeldTransactions;
window.openDiscountModal = openDiscountModal;
window.saveDiscount = saveDiscount;
window.editCartItemQty = editCartItemQty;
window.closeDiscountModal = closeDiscountModal;
window.openSplitPaymentModal = openSplitPaymentModal;
window.updateSplitCalculations = updateSplitCalculations;
window.confirmSplitPayment = confirmSplitPayment;

// ===================== SPLIT PAYMENT =====================
function openSplitPaymentModal() {
  if (cart.length === 0) return;

  // Ensure calculation is up to date
  const total = window.currentTransactionTotal || 0;

  document.getElementById('splitPaymentModal').style.display = 'flex';
  document.getElementById('splitTotalAmount').textContent = total.toFixed(2);

  // Reset inputs
  document.getElementById('splitCash').value = '';
  document.getElementById('splitCard').value = '';
  document.getElementById('splitMobile').value = '';

  updateSplitCalculations();
}

function updateSplitCalculations() {
  const total = window.currentTransactionTotal || 0;
  const cash = parseFloat(document.getElementById('splitCash').value) || 0;
  const card = parseFloat(document.getElementById('splitCard').value) || 0;
  const mobile = parseFloat(document.getElementById('splitMobile').value) || 0;

  const paid = cash + card + mobile;
  const remaining = total - paid;

  const remainingEl = document.getElementById('splitRemaining');
  const confirmBtn = document.getElementById('confirmSplitBtn');

  remainingEl.textContent = remaining.toFixed(2);

  if (Math.abs(remaining) < 0.1) { // Floating point tolerance
    remainingEl.style.color = 'green';
    confirmBtn.disabled = false;
    remainingEl.textContent = "0.00 (Ready)";
  } else {
    remainingEl.style.color = 'red';
    confirmBtn.disabled = true;
  }
}

async function confirmSplitPayment() {
  const cash = parseFloat(document.getElementById('splitCash').value) || 0;
  const card = parseFloat(document.getElementById('splitCard').value) || 0;
  const mobile = parseFloat(document.getElementById('splitMobile').value) || 0;

  const splits = [];
  if (cash > 0) splits.push({ method: 'cash', amount: cash });
  if (card > 0) splits.push({ method: 'card', amount: card });
  if (mobile > 0) splits.push({ method: 'mobile', amount: mobile });

  if (splits.length === 0) return alert("No payments entered");

  const confirmBtn = document.getElementById('confirmSplitBtn');
  if (confirmBtn) confirmBtn.disabled = true;

  window.currentSplitPayments = splits;

  try {
    await processSale('split');
    document.getElementById('splitPaymentModal').style.display = 'none';
  } catch (e) {
    console.error(e);
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}




// ===================== TIMER LOGIC =====================

function toggleItemTimer(index) {
  const item = cart[index];
  if (!item) return;

  if (item.isRunning) {
    // STOP
    const now = Date.now();
    const elapsed = now - item.lastStartTime;
    item.accumulatedTime = (item.accumulatedTime || 0) + elapsed;
    item.isRunning = false;
    item.lastStartTime = null;

    // Update Quantity based on hours
    // accumulatedTime is in ms. 1 hour = 3600000 ms
    const hours = item.accumulatedTime / 3600000;
    // Update qty. Use at least 2 decimals.
    item.qty = parseFloat(hours.toFixed(4)); // Store with precision
    if (item.qty === 0) item.qty = 0.01; // Minimum charge if stopped immediately? Optional.

  } else {
    // START
    item.isRunning = true;
    item.lastStartTime = Date.now();
    if (item.accumulatedTime === undefined) item.accumulatedTime = 0;
  }

  updateCartSummary();
}

function updateLiveTimers() {
  cart.forEach((item, index) => {
    if (item.isRunning) {
      const el = document.getElementById(`timer-${index}`);
      if (el) {
        const currentElapsed = (Date.now() - item.lastStartTime);
        const total = (item.accumulatedTime || 0) + currentElapsed;
        el.textContent = formatDuration(total);
      }
    }
  });
}

function formatDuration(ms) {
  if (!ms) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Start the live update interval
setInterval(updateLiveTimers, 1000);

// Initialize UI state logic
document.addEventListener('DOMContentLoaded', () => {
  // Ensure default state is applied
  try {
    updateCartSummary();
  } catch (e) {
    console.warn("updateCartSummary not ready yet", e);
  }
});

function showLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}