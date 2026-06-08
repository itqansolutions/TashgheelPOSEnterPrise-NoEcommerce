# 🚀 Tashgheel POS — Railway Deployment Guide

## Overview
This guide covers deploying Tashgheel POS to **Railway** with a PostgreSQL database, and connecting it to your GitHub repository for continuous deployment.

---

## Prerequisites
- A [Railway](https://railway.app) account
- A [GitHub](https://github.com) account with this repository pushed

---

## Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit — PostgreSQL migration"
git remote add origin https://github.com/YOUR_USERNAME/tashgheel-pos.git
git push -u origin main
```

---

## Step 2: Create Railway Project

1. Go to [railway.app](https://railway.app) and click **New Project**
2. Select **Deploy from GitHub repo**
3. Connect your GitHub account and choose the `tashgheel-pos` repository

---

## Step 3: Add PostgreSQL Database

1. In your Railway project dashboard, click **Add a Service**
2. Select **Database** → **Add PostgreSQL**
3. Railway will automatically provision a PostgreSQL instance

---

## Step 4: Configure Environment Variables

In Railway dashboard → your **web service** → **Variables** tab, add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `your-random-secret-string-here` |
| `DATABASE_URL` | *(auto-populated by Railway from Postgres service)* |
| `PORT` | *(auto-populated by Railway)* |

> **Note**: Railway automatically injects `DATABASE_URL` from the PostgreSQL service via **reference variables**. Make sure the PostgreSQL service is in the same project.

---

## Step 5: Configure Railway Service Settings

In your web service settings:

- **Start Command**: `node server/index.js`
- **Build Command**: `npm install`
- **Root Directory**: `/` (leave empty)

Or use the included `railway.json` file — Railway will detect it automatically.

---

## Step 6: Deploy

1. Railway will automatically deploy on every `git push` to `main`
2. Watch the deployment logs in Railway dashboard
3. Once deployed, open your public Railway URL

---

## Step 7: First Login

1. Open `https://your-app.railway.app`
2. Register a new business account (this creates your first tenant)
3. Login with your admin credentials

---

## E-Commerce Integration Setup

### Noon Egypt
1. Go to **Admin** → **E-Commerce Settings** → **Noon Egypt**
2. Enter your `noon.partners` seller email and password
3. Enter your **Warehouse/Store Code** (from noon.partners portal)
4. Click **Connect Noon Egypt**
5. Use **Sync Now** in the E-Commerce dashboard to pull orders

### WooCommerce
1. In your WooCommerce store: **WooCommerce** → **Settings** → **Advanced** → **REST API**
2. Generate Consumer Key + Secret with **Read/Write** permissions
3. Enter in Admin → E-Commerce Settings → WooCommerce

### Jumia Egypt
1. Get API key from [Jumia Seller Center](https://sellercenter.jumia.com.eg)
2. Enter API Key and User ID in Admin → E-Commerce Settings → Jumia

### Amazon Egypt (SP-API)
1. Register at [Amazon Seller Central](https://sellercentral.amazon.eg)
2. Create SP-API app and get LWA credentials
3. Enter in Admin → E-Commerce Settings → Amazon

---

## Architecture

```
GitHub Repository
     ↓ (auto-deploy on push)
Railway Web Service (Node.js)
     ↓
Railway PostgreSQL Database
```

**Database Structure**: All data is stored as JSONB in PostgreSQL tables. The adapter in `server/db.js` provides a Mongoose-compatible API so all existing business logic works unchanged.

---

## Troubleshooting

**"Database connection failed"**: Ensure `DATABASE_URL` is set and the PostgreSQL service is running in the same Railway project.

**"Trial expired"**: Log in as admin to manage subscription settings.

**Sync errors on Noon**: Ensure your store code matches exactly what's in the noon.partners portal.
