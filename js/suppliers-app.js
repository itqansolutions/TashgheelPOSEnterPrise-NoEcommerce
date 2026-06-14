// API_URL is provided by auth.js

let suppliers = [];
let currentSupplierId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadSuppliers();
    
    document.getElementById('supplier-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('supplier-id').value;
        const name = document.getElementById('supplier-name').value;
        const phone = document.getElementById('supplier-phone').value;
        const address = document.getElementById('supplier-address').value;

        const payload = { name, phone, address };
        const token = localStorage.getItem('token');

        try {
            let res;
            if (id) {
                res = await fetch(`${API_URL}/suppliers/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch(`${API_URL}/suppliers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify(payload)
                });
            }

            if (res.ok) {
                resetForm();
                loadSuppliers();
            } else {
                alert('Error saving supplier');
            }
        } catch (err) {
            console.error(err);
        }
    });
});

async function loadSuppliers() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/suppliers`, {
            headers: { 'x-auth-token': token }
        });
        suppliers = await res.json();
        renderSuppliers();
    } catch (err) {
        console.error(err);
    }
}

function renderSuppliers() {
    const tbody = document.getElementById('suppliers-body');
    tbody.innerHTML = '';
    
    suppliers.forEach(supp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${supp.name}</td>
            <td>${supp.phone}</td>
            <td>${supp.address || '-'}</td>
            <td style="font-weight:bold; color: ${supp.balance > 0 ? '#e74c3c' : '#2ecc71'}">${supp.balance.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="editSupplier('${supp.id}')">✏️</button>
                <button class="btn btn-sm btn-success" onclick="openPaymentModal('${supp.id}')">💸 Pay</button>
                <button class="btn btn-sm btn-secondary" onclick="openStatementModal('${supp.id}')">📄 Statement</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function editSupplier(id) {
    const supp = suppliers.find(s => s.id === id);
    if (supp) {
        document.getElementById('supplier-id').value = supp.id;
        document.getElementById('supplier-name').value = supp.name;
        document.getElementById('supplier-phone').value = supp.phone;
        document.getElementById('supplier-address').value = supp.address || '';
    }
}

function resetForm() {
    document.getElementById('supplier-id').value = '';
    document.getElementById('supplier-form').reset();
}

function openPaymentModal(id) {
    currentSupplierId = id;
    const supp = suppliers.find(s => s.id === id);
    document.getElementById('paymentSupplierName').textContent = supp.name;
    document.getElementById('paymentSupplierBalance').textContent = supp.balance.toFixed(2);
    document.getElementById('paymentAmount').value = '';
    document.getElementById('paymentNotes').value = '';
    document.getElementById('paymentModal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function submitPayment() {
    if (!currentSupplierId) return;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const notes = document.getElementById('paymentNotes').value;

    if (!amount || amount <= 0) return alert('Invalid amount');

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/suppliers/${currentSupplierId}/pay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify({ amount, notes })
        });
        
        if (res.ok) {
            alert('Payment processed strictly');
            closeModal('paymentModal');
            loadSuppliers();
        } else {
            alert('Payment failed');
        }
    } catch (err) {
        console.error(err);
    }
}

async function openStatementModal(id) {
    currentSupplierId = id;
    const supp = suppliers.find(s => s.id === id);
    document.getElementById('statementSupplierName').textContent = supp.name;
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/suppliers/${id}/statement`, {
            headers: { 'x-auth-token': token }
        });
        const transactions = await res.json();
        
        const tbody = document.getElementById('statement-body');
        tbody.innerHTML = '';
        
        transactions.forEach(tx => {
            const tr = document.createElement('tr');
            const dateStr = new Date(tx.date).toLocaleString();
            let debit = '';
            let credit = '';

            if (tx.amount > 0) debit = tx.amount.toFixed(2); // Debt added (Purchase)
            else credit = Math.abs(tx.amount).toFixed(2);    // Debt reduced (Payment)

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${tx.type.toUpperCase()}</td>
                <td>${tx.notes || '-'}</td>
                <td style="color:#e74c3c">${debit}</td>
                <td style="color:#2ecc71">${credit}</td>
            `;
            tbody.appendChild(tr);
        });
        
        document.getElementById('statementModal').style.display = 'flex';
    } catch (err) {
        console.error(err);
    }
}

function printStatement() {
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Supplier Statement</title>');
    printWindow.document.write('<style>body{font-family:sans-serif;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #ddd;padding:8px;text-align:left;} th{background:#f9f9f9;}</style>');
    printWindow.document.write('</head><body >');
    printWindow.document.write('<h2>Supplier Statement</h2>');
    printWindow.document.write('<p><strong>Supplier:</strong> ' + document.getElementById('statementSupplierName').textContent + '</p>');
    printWindow.document.write(document.getElementById('statementTable').outerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
}
