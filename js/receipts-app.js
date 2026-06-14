// receipts-app.js (Refactored for API)

// API_URL is provided by auth.js
let currentReturnReceipt = null;

async function loadReceipts() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/sales`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) return [];
    const receipts = await response.json();
    return receipts.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (error) {
    console.error('Error loading receipts:', error);
    return [];
  }
}

async function renderReceiptsTable() {
  const tbody = document.getElementById('receiptsTableBody');
  if (!tbody) return;

  const receipts = await loadReceipts();
  const searchTerm = document.getElementById('receiptSearch')?.value.toLowerCase() || '';
  const statusFilter = document.getElementById('statusFilter')?.value || '';

  tbody.innerHTML = '';

  const filtered = receipts.filter(r => {
    const matchText = `${r.cashier || ''} ${r.receiptId || ''}`.toLowerCase();
    const matchStatus = !statusFilter || r.status === statusFilter;
    return matchText.includes(searchTerm) && matchStatus;
  });

  if (filtered.length === 0) {
    const lang = localStorage.getItem('pos_language') || 'en';
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center">${lang === 'ar' ? 'لا توجد مستندات' : 'No receipts found'}</td></tr>`;
    return;
  }

  filtered.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.receiptId || '-'}</td>
      <td>${formatDate(r.date)}</td>
      <td>${r.cashier || '-'}</td>
      <td>${translatePaymentMethod(r.method || r.paymentMethod)}</td>
      <td>${calculateReceiptNetTotal(r).toFixed(2)} ج.م</td>
      <td>${translateStatus(r.status || 'finished')}</td>
      <td>${getReturnReason(r)}</td>
      <td>
        <div style="display:flex; flex-wrap: wrap; gap:5px; justify-content:center;">
          <button class="btn btn-secondary btn-action" title="Print" onclick="printReceipt('${r.id}')">🖨️</button>
          <button class="btn btn-warning btn-action" title="Return" onclick="openReturnModal('${r.id}')">↩️</button>
          <button class="btn btn-danger btn-action" title="Cancel" onclick="cancelSale('${r.id}')">❌</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function getReturnReason(r) {
  if (r.returns && r.returns.length > 0) {
    return r.returns.map(ret => ret.items.map(i => i.reason || '').join(', ')).join('; ') || '-';
  }
  return r.returnReason || '-';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function calculateReceiptNetTotal(receipt) {
  return receipt.total || 0;
}

function translateStatus(status) {
  const lang = localStorage.getItem('pos_language') || 'en';
  const map = {
    finished: { en: 'Finished', ar: 'مكتمل' },
    returned: { en: 'Returned', ar: 'مردود' },
    partial_return: { en: 'Partially Returned', ar: 'مردود جزئي' },
    full_return: { en: 'Fully Returned', ar: 'مردود كلي' },
    cancelled: { en: 'Cancelled', ar: 'ملغي' },
  };
  return map[status]?.[lang] || status;
}

function translatePaymentMethod(method) {
  const lang = localStorage.getItem('pos_language') || 'en';
  const map = {
    cash: { en: 'Cash', ar: 'نقدي' },
    card: { en: 'Card', ar: 'بطاقة' },
    mobile: { en: 'Mobile', ar: 'موبايل' },
    split: { en: 'Split', ar: 'تقسيم' }
  };
  return map[method]?.[lang] || method || '-';
}

async function printReceipt(receiptId) {
  try {
    const token = localStorage.getItem('token');
    let receipt;
    if (typeof receiptId === 'object' && receiptId !== null) {
      receipt = receiptId;
    } else {
      const response = await fetch(`${API_URL}/sales/${receiptId}`, {
        headers: { 'x-auth-token': token }
      });
      if (!response.ok) {
        alert('Failed to load receipt for printing');
        return;
      }
      receipt = await response.json();
    }

    const shopName = localStorage.getItem('shopName') || 'My Shop';
    const shopAddress = localStorage.getItem('shopAddress') || '';
    const shopLogo = localStorage.getItem('shopLogo') || '';
    const receiptFooterMessage = localStorage.getItem('footerMessage') || '';
    const taxRate = parseFloat(localStorage.getItem('taxRate') || 0);
    const taxName = localStorage.getItem('taxName') || 'Tax';

    const lang = localStorage.getItem('pos_language') || 'en';
    const t = (en, ar) => (lang === 'ar' ? ar : en);
    const paymentMap = {
      cash: t("Cash", "نقدي"),
      card: t("Card", "بطاقة"),
      mobile: t("Mobile", "موبايل"),
      split: t("Split", "تقسيم")
    };

    let totalDiscount = receipt.discountAmount || 0;
    let subtotal = receipt.subtotal || 0;
    let taxAmount = receipt.taxAmount || 0;

    const itemsHtml = receipt.items.map(item => {
      const originalTotal = item.price * item.qty;
      let discountStr = "-";

      if (item.discount?.type === "percent") {
        discountStr = `${item.discount.value}%`;
      } else if (item.discount?.type === "value") {
        discountStr = `${item.discount.value.toFixed(2)}`;
      }

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

    let taxSummaryHtml = '';
    if (taxAmount > 0) {
      const taxLabel = `${taxName} (${taxRate}%)`;
      taxSummaryHtml = `<p>${taxLabel}: ${taxAmount.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>`;
    }

    const receiptContent = `
        ${shopLogo ? `<img src="${shopLogo}" class="logo">` : ''}
        <h2 class="center">${shopName}</h2>
        <p class="center">${shopAddress}</p>
        <hr/>
        <p>${t("Receipt No", "رقم الفاتورة")}: ${receipt.receiptId}</p>
        <p>${t("Cashier", "الكاشير")}: ${receipt.cashier}</p>
        <p>${t("Salesman", "البائع")}: ${receipt.salesman || '-'}</p>
        <p>${t("Date", "التاريخ")}: ${dateFormatted}</p>
        <p>${t("Payment Method", "طريقة الدفع")}: ${translatePaymentMethod(receipt.method || receipt.paymentMethod)}</p>
        ${(receipt.method === 'split' || receipt.paymentMethod === 'split') && receipt.splitPayments ?
        receipt.splitPayments.map(p => `<p style="font-size:0.8em; margin-left:10px;">- ${paymentMap[p.method] || p.method}: ${p.amount.toFixed(2)}</p>`).join('')
        : ''}
        <table>
        <thead>
            <tr>
            <th>${t("Code", "الكود")}</th>
            <th>${t("Name", "الاسم")}</th>
            <th>${t("Qty", "الكمية")}</th>
            <th>${t("Unit Price", "سعر")}</th>
            <th>${t("Total", "الإجمالي")}</th>
            <th>${t("Discount", "الخصم")}</th>
            </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        </table>
        <div class="summary">
        <p>${t("Subtotal", "الإجمالي الفرعي")}: ${subtotal.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>
        <p>${t("Total Discount", "إجمالي الخصم")}: ${totalDiscount.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>
        ${taxSummaryHtml}
        <p style="font-size: 1.1em; border-top: 1px dashed #444; margin-top:5px; padding-top:5px;">${t("Total", "الإجمالي النهائي")}: ${receipt.total.toFixed(2)} ${lang === 'ar' ? 'ج.م' : 'EGP'}</p>
        </div>
        <hr/>
        ${receiptFooterMessage ? `<p class="footer" style="font-size:13px; font-weight: bold;">${receiptFooterMessage}</p>` : ''}
        <p class="footer">
        <strong>Tashgheel POS &copy; 2025</strong><br>
        📞 <a href="tel:+201126522373">01126522373</a> / <a href="tel:+201155253886">01155253886</a><br>
        <span id="footerText">${t("Designed and developed by Itqan", "تصميم وتطوير Itqan")}</span>
        </p>
    `;

    const html = `
      <html>
      <head>
        <title>${t("Receipt", "الإيصال")}</title>
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
        <div class="receipt-container">${receiptContent}</div>
      </body>
      </html>
    `;

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

    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
    }, 500);

  } catch (error) {
    console.error('Error printing receipt:', error);
    alert('Failed to print receipt');
  }
}

function updateReceiptsLanguage(lang) {
  const search = document.getElementById('receiptSearch');
  if (search) {
    search.placeholder = lang === 'ar' ? 'بحث بالكاشير أو رقم المستند...' : 'Search by cashier or code...';
  }
  const filter = document.getElementById('statusFilter');
  if (filter) {
    filter.options[0].textContent = lang === 'ar' ? 'كل الحالات' : 'All Status';
    filter.options[1].textContent = lang === 'ar' ? 'مكتمل' : 'Finished';
    filter.options[2].textContent = lang === 'ar' ? 'مردود جزئي' : 'Partial Return';
    filter.options[3].textContent = lang === 'ar' ? 'مردود كلي' : 'Full Return';
    filter.options[4].textContent = lang === 'ar' ? 'ملغي' : 'Cancelled';
  }
}

// ================= RETURN LOGIC =================
async function openReturnModal(receiptId) {
  const token = localStorage.getItem('token');
  try {
    const response = await fetch(`${API_URL}/sales/${receiptId}`, {
      headers: { 'x-auth-token': token }
    });
    if (!response.ok) return alert("Failed to fetch receipt data");
    currentReturnReceipt = await response.json();
  } catch (e) {
    console.error(e);
    return alert("Error loading receipt");
  }

  const modal = document.getElementById('returnModal');
  const tbody = document.getElementById('returnItemsTableBody');
  tbody.innerHTML = '';

  currentReturnReceipt.items.forEach((item, index) => {
    const soldQty = item.qty;
    const returnedQty = item.returnedQty || 0;
    const remainingQty = soldQty - returnedQty;

    if (remainingQty <= 0) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
            <td><input type="checkbox" class="return-check" data-index="${index}" onchange="toggleReturnInput(${index})"></td>
            <td>${item.name} <small>(${item.code || '-'})</small></td>
            <td>${remainingQty}</td>
            <td><input type="number" class="return-input" id="return-qty-${index}" min="1" max="${remainingQty}" value="1" disabled style="width: 60px;"></td>
        `;
    tbody.appendChild(tr);
  });

  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">All items in this receipt have been returned.</td></tr>';
    document.querySelector('#returnModal .btn-success').disabled = true;
  } else {
    document.querySelector('#returnModal .btn-success').disabled = false;
  }

  modal.style.display = 'block';
}

function toggleReturnInput(index) {
  const checkbox = document.querySelector(`.return-check[data-index="${index}"]`);
  const input = document.getElementById(`return-qty-${index}`);
  if (checkbox && input) {
    input.disabled = !checkbox.checked;
    if (!checkbox.checked) input.value = 1;
  }
}

function closeReturnModal() {
  document.getElementById('returnModal').style.display = 'none';
  currentReturnReceipt = null;
  document.getElementById('returnReason').value = '';
}

async function confirmPartialReturn() {
  if (!currentReturnReceipt) return;

  const checks = document.querySelectorAll('.return-check:checked');
  if (checks.length === 0) return alert("Please select at least one item to return.");

  const itemsToReturn = [];
  const reason = document.getElementById('returnReason').value.trim();

  for (const chk of checks) {
    const index = chk.dataset.index;
    const item = currentReturnReceipt.items[index];
    const qtyInput = document.getElementById(`return-qty-${index}`);
    const qty = parseFloat(qtyInput.value);

    if (qty <= 0) return alert(`Invalid quantity for ${item.name}`);
    if (qty > (item.qty - (item.returnedQty || 0))) return alert(`Qty exceeds remaining stock for ${item.name}`);

    itemsToReturn.push({
      code: item.code || item.id, // Send code or ID to backend
      qty: qty,
      reason: reason
    });
  }

  if (!confirm("Confirm return of selected items?")) return;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/sales/${currentReturnReceipt.id || currentReturnReceipt.receiptId}/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify({ items: itemsToReturn, reason })
    });

    if (response.ok) {
      alert("Items returned successfully");
      closeReturnModal();
      renderReceiptsTable();
    } else {
      const err = await response.json();
      alert("Return failed: " + (err.msg || "Unknown error"));
    }
  } catch (e) {
    console.error(e);
    alert("Error processing return");
  }
}

async function cancelSale(receiptId) {
  const lang = localStorage.getItem('pos_language') || 'en';
  const confirmMsg = lang === 'ar' ?
    "هل أنت متأكد من إلغاء هذا المستند بالكامل؟ سيتم إرجاع جميع الأصناف للمخزون." :
    "Are you sure you want to CANCEL this entire sale? All items will be returned to stock.";

  if (!confirm(confirmMsg)) return;

  // Fetch receipt to get all items
  try {
    const token = localStorage.getItem('token');
    let receipt;
    const res = await fetch(`${API_URL}/sales/${receiptId}`, { headers: { 'x-auth-token': token } });
    if (!res.ok) return alert("Failed to fetch sale details");
    receipt = await res.json();

    // Prepare items array for full return
    // Only return what hasn't been returned yet
    const itemsToReturn = [];
    receipt.items.forEach(item => {
      const remaining = item.qty - (item.returnedQty || 0);
      if (remaining > 0) {
        itemsToReturn.push({
          code: item.code || item.id,
          qty: remaining
        });
      }
    });

    if (itemsToReturn.length === 0) {
      return alert("This sale is already fully returned.");
    }

    const response = await fetch(`${API_URL}/sales/${receipt.id}/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': token
      },
      body: JSON.stringify({
        items: itemsToReturn,
        reason: "Full Cancellation"
      })
    });

    if (response.ok) {
      alert(lang === 'ar' ? "تم الإلغاء بنجاح" : "Sale cancelled successfully");
      renderReceiptsTable();
    } else {
      const err = await response.json();
      alert("Cancellation failed: " + (err.msg || "Unknown error"));
    }

  } catch (e) {
    console.error(e);
    alert("Error during cancellation");
  }
}


// ============== INIT ==============
window.addEventListener('DOMContentLoaded', () => {
  renderReceiptsTable();
  const searchInput = document.getElementById('receiptSearch');
  const statusFilter = document.getElementById('statusFilter');

  if (searchInput) {
    searchInput.addEventListener('input', renderReceiptsTable);
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', renderReceiptsTable);
  }

  const lang = localStorage.getItem('pos_language') || 'en';
  updateReceiptsLanguage(lang);
});
