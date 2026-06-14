// API_URL is provided by auth.js

let customers = [];
let currentCustomerId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCustomers();
    
    document.getElementById('customer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('customer-id').value;
        const name = document.getElementById('customer-name').value;
        const phone = document.getElementById('customer-phone').value;
        const address = document.getElementById('customer-address').value;

        const payload = { name, phone, address };
        const token = localStorage.getItem('token');

        try {
            let res;
            if (id) {
                res = await fetch(`${API_URL}/customers/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch(`${API_URL}/customers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
                    body: JSON.stringify(payload)
                });
            }

            if (res.ok) {
                resetForm();
                loadCustomers();
            } else {
                alert('Error saving customer');
            }
        } catch (err) {
            console.error(err);
        }
    });
});

async function loadCustomers() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/customers`, {
            headers: { 'x-auth-token': token }
        });
        customers = await res.json();
        renderCustomers();
    } catch (err) {
        console.error(err);
    }
}

function renderCustomers() {
    const tbody = document.getElementById('customers-body');
    tbody.innerHTML = '';
    
    customers.forEach(cust => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${cust.name}</td>
            <td>${cust.phone}</td>
            <td>${cust.address || '-'}</td>
            <td style="font-weight:bold; color: ${cust.balance > 0 ? '#e74c3c' : '#2ecc71'}">${cust.balance.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="editCustomer('${cust.id}')">✏️</button>
                <button class="btn btn-sm btn-success" onclick="openPaymentModal('${cust.id}')">💸 Receive</button>
                <button class="btn btn-sm btn-secondary" onclick="openStatementModal('${cust.id}')">📄 Statement</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function editCustomer(id) {
    const cust = customers.find(c => c.id === id);
    if (cust) {
        document.getElementById('customer-id').value = cust.id;
        document.getElementById('customer-name').value = cust.name;
        document.getElementById('customer-phone').value = cust.phone;
        document.getElementById('customer-address').value = cust.address || '';
    }
}

function resetForm() {
    document.getElementById('customer-id').value = '';
    document.getElementById('customer-form').reset();
}

function openPaymentModal(id) {
    currentCustomerId = id;
    const cust = customers.find(c => c.id === id);
    document.getElementById('paymentCustomerName').textContent = cust.name;
    document.getElementById('paymentCustomerBalance').textContent = cust.balance.toFixed(2);
    document.getElementById('paymentAmount').value = '';
    document.getElementById('paymentNotes').value = '';
    document.getElementById('paymentModal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function submitPayment() {
    if (!currentCustomerId) return;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const notes = document.getElementById('paymentNotes').value;

    if (!amount || amount <= 0) return alert('Invalid amount');

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/customers/${currentCustomerId}/pay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify({ amount, notes })
        });
        
        if (res.ok) {
            alert('Payment processed successfully');
            closeModal('paymentModal');
            loadCustomers();
        } else {
            alert('Payment failed');
        }
    } catch (err) {
        console.error(err);
    }
}

async function openStatementModal(id) {
    currentCustomerId = id;
    const cust = customers.find(c => c.id === id);
    document.getElementById('statementCustomerName').textContent = cust.name;
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/customers/${id}/statement`, {
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

            if (tx.amount > 0) debit = tx.amount.toFixed(2); // Debt added (Sale on credit)
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
    printWindow.document.write('<html><head><title>Customer Statement</title>');
    printWindow.document.write('<style>body{font-family:sans-serif;} table{width:100%;border-collapse:collapse;margin-top:20px;} th,td{border:1px solid #ddd;padding:8px;text-align:left;} th{background:#f9f9f9;}</style>');
    printWindow.document.write('</head><body >');
    printWindow.document.write('<h2>Customer Statement</h2>');
    printWindow.document.write('<p><strong>Customer:</strong> ' + document.getElementById('statementCustomerName').textContent + '</p>');
    printWindow.document.write(document.getElementById('statementTable').outerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
}
