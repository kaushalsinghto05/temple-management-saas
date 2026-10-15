# Deploying Temple Management SaaS to Render

This guide provides step-by-step instructions for deploying the **Multi-Tenant Temple Management SaaS** to [Render](https://render.com/).

---

## Architecture on Render

```
  Devotees & Admins
         │
         ▼
 ┌──────────────────────────────────────┐
 │      Render Web Service (Next.js)    │
 │   URL: https://<app>.onrender.com   │
 │   - Port: 10000                      │
 │   - Health: /api/health              │
 └──────────────────┬───────────────────┘
                    │ Pooled Connection (SSL)
                    ▼
 ┌──────────────────────────────────────┐
 │     Render Managed PostgreSQL        │
 │   - Version: 16                      │
 │   - Auto-migrated with RLS policies  │
 └──────────────────────────────────────┘
```

---

## Method 1: Render Blueprint (Recommended — 1-Click IaC)

The repository includes a [`render.yaml`](file:///c:/Users/Kaushal%20Singh/Desktop/Trust/render.yaml) blueprint specification that automatically provisions both the PostgreSQL database and the Next.js web application.

### Steps:
1. **Push your code to a Git repository** (GitHub or GitLab):
   ```bash
   git init
   git add .
   git commit -m "feat: complete temple management SaaS"
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. **Log in to [Render Dashboard](https://dashboard.render.com/)**.
3. Click **New +** in the top right and select **Blueprint**.
4. Connect your Git repository.
5. Render will automatically detect [`render.yaml`](file:///c:/Users/Kaushal%20Singh/Desktop/Trust/render.yaml) and display:
   - **Database:** `temple-db` (PostgreSQL 16)
   - **Web Service:** `temple-management-saas` (Node.js runtime)
   - **Environment Variables:** Automatically mapped (`DATABASE_URL` linked to database, `SESSION_SECRET` generated)
6. Click **Apply**.
7. Render will:
   - Provision the managed database.
   - Run `npm install && npm run build`.
   - Execute `preDeployCommand: npm run db:init` (creates tables, foreign keys, and RLS policies).
   - Start the web service with `npm start` on port 10000.

---

## Method 2: Manual Dashboard Setup

If you prefer configuring resources manually in the Render UI:

### Step 1: Create PostgreSQL Database
1. In Render Dashboard, click **New +** -> **PostgreSQL**.
2. **Name:** `temple-db`
3. **Database:** `temple_saas`
4. **User:** `temple_admin`
5. **Region:** Oregon (or closest to your users)
6. **Plan:** Free or Starter
7. Click **Create Database**.
8. Once created, copy the **Internal Database URL** (e.g., `postgresql://temple_admin:...@dpg-...-a/temple_saas`).

### Step 2: Create Web Service
1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure settings:
   - **Name:** `temple-management-saas`
   - **Language / Runtime:** `Node`
   - **Branch:** `main`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run db:init && npm start`
   - **Health Check Path:** `/api/health`
4. Add **Environment Variables**:
   | Key | Value | Notes |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Enables production optimizations & SSL |
   | `DATABASE_URL` | `postgresql://...` | Internal Database URL from Step 1 |
   | `PORT` | `10000` | Render standard HTTP port |
   | `DEFAULT_TIMEZONE` | `Asia/Kolkata` | Temple business reporting timezone |
   | `DEFAULT_CURRENCY` | `INR` | Default currency |
   | `SESSION_SECRET` | *(Click "Generate")* | Cryptographic cookie session secret |
5. Click **Create Web Service**.

---

## Post-Deployment Verification

Once Render displays **Service is live**:

1. **Health Check:**
   ```bash
   curl https://<your-app>.onrender.com/api/health
   ```
   Expected response:
   ```json
   {
     "status": "ok",
     "service": "temple-trust-platform",
     "uptimeSeconds": 15,
     "environment": "production"
   }
   ```

2. **Register Platform Super Admin:**
   ```bash
   curl -X POST https://<your-app>.onrender.com/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "admin@yourtempletrust.org",
       "fullName": "Super Administrator",
       "password": "StrongPassword123!"
     }'
   ```

3. **Configure Payment Provider Webhook:**
   - In Razorpay or Stripe dashboard, set the webhook callback URL to:
     `https://<your-app>.onrender.com/api/webhooks/payment/razorpay`
   - Set events to listen for: `payment.captured`, `payment.failed`, `refund.processed`.
   - Copy the webhook secret and configure it on the temple via `POST /api/admin/temples/{id}/payment-config`.
