const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Connect to PostgreSQL via Prisma
const prisma = require('./prisma');

async function startServer() {
    try {
        await prisma.$connect();
        console.log('PostgreSQL Connected via Prisma ✓');

        // Serve static files from the parent directory
        const path = require('path');
        app.use(express.static(path.join(__dirname, '../')));

        // Routes
        app.use('/api/auth', require('./routes/auth'));
        app.use('/api', require('./routes/api'));
        app.use('/api/super-admin', require('./routes/super-admin'));
        app.use('/api/integrations', require('./routes/integrations'));
        app.use('/api/suspended-invoices', require('./routes/suspended-invoices'));
        app.use('/api/open-orders', require('./routes/open-orders'));
        app.use('/api/stock-transfers', require('./routes/stock-transfers'));
        app.use('/api/reports', require('./routes/reports-extended'));

        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => console.log(`Server started on port ${PORT} [v4-prisma]`));
    } catch (err) {
        console.error('Database connection failed:', err.message);
        process.exit(1);
    }
}

startServer();

module.exports = app;
