// reports-app.js (Refactored for API)

// API_URL is provided by auth.js

document.addEventListener('DOMContentLoaded', () => {
  const lang = localStorage.getItem('pos_language') || 'en';
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const safe = n => Math.max(0, n);

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  const fromDateInput = document.getElementById('report-from');
  const toDateInput = document.getElementById('report-to');

  document.querySelectorAll('.report-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.report-tab').forEach(btn => btn.classList.remove('active'));
      tab.classList.add('active');
      const selected = tab.dataset.tab;
      document.querySelectorAll('.report-card').forEach(card => card.style.display = 'none');
      document.getElementById('card-' + selected).style.display = 'block';
      runReport(selected);
      updateHeaders();
    });
  });

  document.getElementById('report-from').addEventListener('change', refreshReports);
  document.getElementById('report-to').addEventListener('change', refreshReports);
    const generateBtn = document.getElementById('generate-report');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateReport);
    }
});

// Expose to global scope for HTML onclick
window.generateReport = generateReport;

async function generateReport() {
    const activeTab = document.querySelector('.report-tab.active')?.dataset.tab || 'sales';
    runReport(activeTab);
  }

  function normalizeMethod(method) {
    method = (method || '').toLowerCase();
    if (method.includes('cash') || method.includes('نقد')) return 'cash';
    if (method.includes('card') || method.includes('بطاق')) return 'card';
    if (method.includes('mobile') || method.includes('موبايل')) return 'mobile';
    return 'unknown';
  }

  let allSales = [];
  let allProducts = [];

  async function loadData() {
    try {
      const token = localStorage.getItem('token');
      const [salesRes, productsRes] = await Promise.all([
        fetch(`${API_URL}/sales`, { headers: { 'x-auth-token': token } }),
        fetch(`${API_URL}/products`, { headers: { 'x-auth-token': token } })
      ]);

      if (salesRes.ok) allSales = await salesRes.json();
      if (productsRes.ok) allProducts = await productsRes.json();

      runReport('sales');
    } catch (error) {
      console.error('Error loading report data:', error);
    }
  }

  function runReport(type) {
    const fromDate = fromDateInput.value ? new Date(fromDateInput.value) : null;
    const toDate = toDateInput.value ? new Date(toDateInput.value) : null;
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const receipts = allSales.filter(r => {
      const d = new Date(r.date);
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });

    const productMap = {};
    allProducts.forEach(p => productMap[String(p.barcode)] = p);

    if (type === 'stock-value') {
      generateStockValueReport();
    }

    if (type === 'sales') {
      let totalCash = 0, totalCard = 0, totalMobile = 0, totalDiscount = 0, totalReturns = 0;

      receipts.forEach(r => {
        // 1. Calculate Original Sales (GROSS & NET) from items
        let receiptDiscount = 0;
        let receiptGross = 0;

        r.items.forEach(i => {
          const d = i.discount?.type === 'percent'
            ? i.price * i.discount.value / 100 * i.qty
            : (i.discount?.value || 0) * i.qty;
          receiptDiscount += d;
          receiptGross += i.qty * i.price;
        });

        totalDiscount += receiptDiscount;

        const method = normalizeMethod(r.method || r.paymentMethod);
        const netSale = receiptGross - receiptDiscount;

        // Render to table if on sales tab
        if (type === 'sales') {
            const tbody = document.getElementById('reports-table-body');
            const row = tbody.insertRow();
            const date = new Date(r.date);
            const typeLabel = r.orderType === 'online' ? '<span class="badge badge-primary">Online</span>' : '<span class="badge badge-success">In-Store</span>';
            const platformLabel = r.platform === 'woocommerce' ? '<span class="text-brand-purple">🟣 WooCommerce</span>' : 
                                 r.platform === 'jumia' ? '<span class="text-brand-orange">🟠 Jumia</span>' :
                                 r.platform === 'amazon' ? '<span class="text-brand-blue">🔵 Amazon</span>' : 
                                 '<span class="text-gray-400">Local</span>';

            row.innerHTML = `
                <td>${date.toLocaleDateString()}</td>
                <td class="font-bold">${r.receiptId}</td>
                <td>${typeLabel}</td>
                <td>${platformLabel}</td>
                <td class="font-bold">${netSale.toFixed(2)}</td>
                <td class="text-green-600">${(netSale - r.items.reduce((acc, i) => acc + (i.qty * (productMap[i.barcode]?.cost || 0)), 0)).toFixed(2)}</td>
            `;
        }

        if (r.method === 'split' && r.splitPayments) {
          r.splitPayments.forEach(sp => {
            const m = normalizeMethod(sp.method);
            if (m === 'cash') totalCash += sp.amount;
            if (m === 'card') totalCard += sp.amount;
            if (m === 'mobile') totalMobile += sp.amount;
          });
        } else {
          if (method === 'cash') totalCash += netSale;
          if (method === 'card') totalCard += netSale;
          if (method === 'mobile') totalMobile += netSale;
        }

        // 2. Calculate Returns
        if (r.returns && r.returns.length > 0) {
          r.returns.forEach(ret => {
            totalReturns += ret.totalRefund || 0;
            // Since we don't know exact method returned (often cash), we might skew.
            // Safest: Deduct from CASH for now as per common retail logic unless specified.
            // OR: Just track totalReturns and display it. The user said "takes too long to finish receipt".

            // Actually, better to just Sum Total Sales (positive) and Total Returns (negative) separately.
            // But the cards are "Sales Cash", "Sales Card". 
            // If we don't deduct returns, they will show high amounts. 
          });
        }
      });

      // Since specific method return tracking isn't in backend yet, we will display Net Sales (Cash/Card/Mobile) 
      // ignoring returns deduction per method, but show Total Returns clearly.
      // Wait, if I returned 50 EGP cash, my Cash drawer should show -50. 
      // I will deduct ONLY if I can trust the method. 
      // Current system: Cancel/Return doesn't specify method but usually original.
      // Let's keep it simple: Show Gross Net Sales per method. Show Total Returns. 
      // And maybe a "Net Revenue" which is (Cash+Card+Mobile - Returns).

      // Update: User said "returns recorded incorrectly". Logic:
      // Old logic: receipts.filter(full_return).forEach( ... sign = -1 )
      // This subtracted the *entire* sale. 
      // New logic: Sum all sales. Sum all returns. 
      // If we want "Total Sales Cash" to be purely sales, don't subtract. 
      // However the closing report subtracts returns. So here we should probably do similar?
      // Let's calculate purely Sales here (Inflow) and display Claims/Returns separately?
      // The IDs are `total-sales-cash`, `total-sales-card`. 

      // Let's deduct returns from totals to make it specific.
      // Assumption: Return method = Original method.

      receipts.forEach(r => {
        const method = normalizeMethod(r.method || r.paymentMethod);
        let methodReturn = 0;
        if (r.returns) {
          r.returns.forEach(ret => methodReturn += ret.totalRefund);
        }
        if (methodReturn > 0) {
          // Deduct from appropriate bucket
          if (r.method === 'split') {
            // Complex, just deduct from Cash for safety or proportional? 
            // Let's deduct from Cash.
            totalCash -= methodReturn;
          } else {
            if (method === 'cash') totalCash -= methodReturn;
            if (method === 'card') totalCard -= methodReturn;
            if (method === 'mobile') totalMobile -= methodReturn;
          }
        }
      });


      document.getElementById('total-sales-cash').textContent = safe(totalCash).toFixed(2) + ' EGP';
      document.getElementById('total-sales-card').textContent = safe(totalCard).toFixed(2) + ' EGP';
      document.getElementById('total-sales-mobile').textContent = safe(totalMobile).toFixed(2) + ' EGP';
      document.getElementById('total-discounts').textContent = safe(totalDiscount).toFixed(2) + ' EGP';
    }

    if (type === 'cogs') {
      let totalCost = 0;
      receipts.forEach(r => {
        // Add cost of sold items
        r.items.forEach(i => {
          const cost = productMap[String(i.code)]?.cost || i.cost || 0;
          totalCost += i.qty * cost;
        });

        // Subtract cost of returned items
        if (r.returns) {
          r.returns.forEach(ret => {
            ret.items.forEach(ri => {
              const cost = productMap[String(ri.code)]?.cost || 0; // Need to fetch from product map, item cost might not be in return record
              // If return record only has code and qty, use productMap.
              totalCost -= ri.qty * cost;
            });
          });
        }
      });
      document.getElementById('total-cogs').textContent = safe(totalCost).toFixed(2) + ' EGP';
    }

    if (type === 'profit') {
      let profit = 0;
      receipts.forEach(r => {
        let saleProfit = 0;
        r.items.forEach(i => {
          const cost = productMap[String(i.code)]?.cost || i.cost || 0;
          const discount = i.discount?.type === 'percent' ? (i.price * i.discount.value / 100) : i.discount?.value || 0;
          const net = i.price - discount;
          saleProfit += i.qty * (net - cost);
        });

        // Deduct profit for returns
        if (r.returns) {
          r.returns.forEach(ret => {
            ret.items.forEach(ri => {
              // We need to approximate the profit reversal. 
              // Refund Amount - (Qty * Cost)
              // Since we don't have per-item refund in ret.items easily (we calc'd it in backend but typically just code/qty)
              // Let's try to find original item.
              const originalItem = r.items.find(oi => oi.code === ri.code || oi.id === ri.code);
              if (originalItem) {
                const cost = productMap[String(ri.code)]?.cost || originalItem.cost || 0;
                const discount = originalItem.discount?.type === 'percent' ? (originalItem.price * originalItem.discount.value / 100) : originalItem.discount?.value || 0;
                const net = originalItem.price - discount; // This was unit price sold

                saleProfit -= ri.qty * (net - cost);
              }
            });
          });
        }
        profit += saleProfit;
      });
      document.getElementById('total-profit').textContent = safe(profit).toFixed(2) + ' EGP';
    }

    if (type === 'returns') {
      let total = 0;
      receipts.forEach(r => {
        if (r.returns) {
          r.returns.forEach(ret => total += ret.totalRefund);
        }
      });
      document.getElementById('total-returns').textContent = safe(total).toFixed(2) + ' EGP';
    }

    if (type === 'by-product') {
      const map = {};
      receipts.forEach(r => {
        // Add Sold
        r.items.forEach(i => {
          const code = String(i.code);
          if (!map[code]) {
            const product = productMap[code];
            map[code] = {
              code,
              name: product?.name || i.name || t("Unknown", "غير معروف"),
              category: product?.category || t("Uncategorized", "بدون تصنيف"),
              stock: product?.stock || 0,
              qty: 0,
              totalBefore: 0,
              discount: 0,
              totalAfter: 0
            };
          }
          const discountValue = i.discount?.type === 'percent'
            ? i.price * i.discount.value / 100
            : i.discount?.value || 0;
          const net = i.price - discountValue;

          map[code].qty += i.qty;
          map[code].totalBefore += i.qty * i.price;
          map[code].discount += discountValue * i.qty;
          map[code].totalAfter += i.qty * net;
        });

        // Subtract Returned
        if (r.returns) {
          r.returns.forEach(ret => {
            ret.items.forEach(ri => {
              const code = String(ri.code);
              if (map[code]) {
                // Find original price/discount to reverse
                // Approximation: Use current map averages or find original item
                const originalItem = r.items.find(oi => oi.code === ri.code || oi.id === ri.code);
                if (originalItem) {
                  const discountValue = originalItem.discount?.type === 'percent'
                    ? originalItem.price * originalItem.discount.value / 100
                    : originalItem.discount?.value || 0;
                  const net = originalItem.price - discountValue;

                  map[code].qty -= ri.qty;
                  map[code].totalBefore -= ri.qty * originalItem.price;
                  map[code].discount -= ri.qty * discountValue;
                  map[code].totalAfter -= ri.qty * net;
                }
              }
            });
          });
        }
      });

      renderTable('table-by-product', map,
        ['code', 'name', 'stock', 'qty', 'totalBefore', 'discount', 'totalAfter'],
        [
          t("Code", "الكود"),
          t("Name", "الاسم"),
          t("Stock Quantity", "الكمية بالمخزون"),
          t("Net Sold Quantity", "صافي الكمية المباعة"),
          t("Total Before Discount", "الإجمالي قبل الخصم"),
          t("Discount", "الخصم"),
          t("Net Sales", "الصافي بعد الخصم")
        ]);
    }


    if (type === 'by-category') {
      const categoryMap = {};
      receipts.forEach(r => {
        // Add Sold
        r.items.forEach(i => {
          const code = String(i.code);
          const category = productMap[code]?.category || t("Uncategorized", "بدون تصنيف");
          if (!categoryMap[category]) categoryMap[category] = { category, qty: 0, total: 0 };
          const discount = i.discount?.type === 'percent'
            ? i.price * i.discount.value / 100
            : i.discount?.value || 0;
          const net = i.price - discount;
          categoryMap[category].qty += i.qty;
          categoryMap[category].total += i.qty * net;
        });

        // Subtract Returned
        if (r.returns) {
          r.returns.forEach(ret => {
            ret.items.forEach(ri => {
              const code = String(ri.code);
              const category = productMap[code]?.category || t("Uncategorized", "بدون تصنيف");
              if (categoryMap[category]) {
                const originalItem = r.items.find(oi => oi.code === ri.code || oi.id === ri.code);
                if (originalItem) {
                  const discount = originalItem.discount?.type === 'percent'
                    ? originalItem.price * originalItem.discount.value / 100
                    : originalItem.discount?.value || 0;
                  const net = originalItem.price - discount;
                  categoryMap[category].qty -= ri.qty;
                  categoryMap[category].total -= ri.qty * net;
                }
              }
            });
          });
        }
      });
      renderTable('table-by-category', categoryMap, ['category', 'qty', 'total'], [
        t("Category", "التصنيف"),
        t("Net Quantity", "صافي الكمية"),
        t("Net Sales EGP", "صافي المبيعات")
      ]);
    }

    if (type === 'by-user') {
      const map = {};
      receipts.forEach(r => {
        const cashier = r.cashier || t("Unknown", "غير معروف");
        if (!map[cashier]) map[cashier] = { cashier, total: 0, discount: 0, net: 0 };

        r.items.forEach(i => {
          const discount = i.discount?.type === 'percent'
            ? i.price * i.discount.value / 100 * i.qty
            : i.discount?.value * i.qty || 0;

          const total = i.qty * i.price;
          map[cashier].total += total;
          map[cashier].discount += discount;
          map[cashier].net += (total - discount);
        });

        // Subtract Returns
        if (r.returns) {
          r.returns.forEach(ret => {
            let retDiscount = 0;
            let retTotal = 0;
            let retNet = 0;
            ret.items.forEach(ri => {
              const originalItem = r.items.find(oi => oi.code === ri.code || oi.id === ri.code);
              if (originalItem) {
                const discountVal = originalItem.discount?.type === 'percent'
                  ? originalItem.price * originalItem.discount.value / 100
                  : originalItem.discount?.value || 0;

                retDiscount += discountVal * ri.qty;
                retTotal += originalItem.price * ri.qty;
                retNet += (originalItem.price - discountVal) * ri.qty;
              }
            });
            map[cashier].total -= retTotal;
            map[cashier].discount -= retDiscount;
            map[cashier].net -= retNet;
          });
        }
      });

      renderTable('table-by-user', map, ['cashier', 'total', 'discount', 'net'], [
        t("Cashier", "الكاشير"),
        t("Total Sales EGP", "إجمالي المبيعات"),
        t("Total Discount EGP", "إجمالي الخصومات"),
        t("Net Sales EGP", "صافي المبيعات")
      ]);
    }
  }

  function generateStockValueReport() {
    const table = document.getElementById('table-stock-value');
    table.innerHTML = '';

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `
      <th>${t('Category', 'التصنيف')}</th>
      <th>${t('Total Stock Cost', 'إجمالي تكلفة المخزون')} (ج.م)</th>
    `;
    table.appendChild(headerRow);

    const categoryMap = {};
    let grandTotal = 0;

    allProducts.forEach(p => {
      const category = p.category || t('Uncategorized', 'غير مصنف');
      const cost = parseFloat(p.cost || 0);
      const stock = parseFloat(p.stock || 0);
      const total = cost * stock;
      if (!categoryMap[category]) categoryMap[category] = 0;
      categoryMap[category] += total;
      grandTotal += total;
    });

    for (const category in categoryMap) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${category}</td>
        <td>${categoryMap[category].toFixed(2)}</td>
      `;
      table.appendChild(row);
    }

    const finalRow = document.createElement('tr');
    finalRow.innerHTML = `
      <td><strong>${t('Total', 'الإجمالي')}</strong></td>
      <td><strong>${grandTotal.toFixed(2)}</strong></td>
    `;
    table.appendChild(finalRow);
  }

  function renderTable(tableId, dataMap, fields, headers) {
    const table = document.getElementById(tableId);
    table.innerHTML = '';
    const thead = table.insertRow();
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      thead.appendChild(th);
    });

    Object.values(dataMap).forEach(row => {
      const tr = table.insertRow();
      fields.forEach(field => {
        const td = tr.insertCell();
        td.textContent = (row[field] || 0).toFixed ? row[field].toFixed(2) : row[field];
      });
    });
  }

  function updateHeaders() {
    document.querySelectorAll('[data-i18n-key]').forEach(el => {
      const key = el.dataset.i18nKey;
      if (Array.isArray(key)) return;
      el.textContent = t(key, el.dataset.i18nAr);
    });
  }

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(e => e.style.display = 'block');
  }

  updateHeaders();
  loadData();
});
