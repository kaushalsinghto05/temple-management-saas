# Multi-Tenant Temple Management SaaS Platform

A modern, production-grade multi-tenant SaaS platform designed for Hindu temples and religious trusts. Built with Next.js (App Router), TypeScript, Drizzle ORM, and PostgreSQL with Row-Level Security (RLS).

---

## Key Features

- **Multi-Tenant Data Isolation:** Strict tenant separation via PostgreSQL Row-Level Security (`SET LOCAL app.current_tenant_id`) with zero pool connection context leakage.
- **Direct Merchant Payments:** Devotees pay directly into the temple's approved merchant account. The platform never co-mingles or holds custodial possession of funds.
- **High-Concurrency Puja Booking:** Atomic conditional slot capacity reservation preventing overselling under heavy concurrent booking loads. 10-minute hold TTL with automatic release.
- **Donation Management & Sequential Receipts:** Automated sequential fiscal-year numbering (`RCP-TENANT-YYYY-XXXX`) with Section 80G tax exemption disclaimers and immutable revision histories.
- **Timezone-Aware Reporting:** Transactions stored in UTC `TIMESTAMPTZ` and dynamically aggregated by temple business day in local time (`Asia/Kolkata`). RFC 4180 CSV exports.
- **Daily Operations & Devotee Self-Service:** Daily operations dashboard, devotee check-in attendance fulfillment, and devotee booking & donation history.
- **Platform Oversight & Reconciliation Queue:** Centralized platform health dashboard, webhook failure monitoring, and manual exception resolution.
- **100% Automated Test Coverage:** 24 test suites, 70 automated integration and acceptance tests passing (AT-01 to AT-12 + Full E2E Pilot Acceptance).

---

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript 7 (Strict Mode)
- **ORM / Database:** Drizzle ORM with PostgreSQL & in-memory PGlite for rapid CI testing
- **Authentication:** Stateless cryptographically signed HTTP-only sessions with Argon2id password hashing and RFC 6238 TOTP MFA
- **Testing:** Vitest with isolated tenant environments
- **Deployment:** Render Blueprint (`render.yaml`) & Dockerfile

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+

### Installation
```bash
git clone https://github.com/kaushalsinghto05/temple-management-saas.git
cd temple-management-saas
npm install
```

### Database Initialization
```bash
npm run db:init
```

### Development Server
```bash
npm run dev
```

### Running Tests
```bash
npm test
```

### Type Checking & Production Build
```bash
npx tsc --noEmit
npm run build
```

---

## Acceptance Test Suite (AT-01 to AT-12)

| Test ID | Scenario | Status |
| :--- | :--- | :--- |
| **AT-01** | Cross-tenant data isolation and resource boundary enforcement | **PASSED** |
| **AT-02** | High-concurrency race condition capacity hold & zero overselling | **PASSED** |
| **AT-03** | Browser return redirect disregarded without server webhook | **PASSED** |
| **AT-04** | Idempotent webhook processing & deduplication journal | **PASSED** |
| **AT-05** | Webhook amount/currency mismatch quarantining | **PASSED** |
| **AT-06** | Late payment after hold expiration quarantined | **PASSED** |
| **AT-07** | Devotee receipt isolation | **PASSED** |
| **AT-08** | Unauthorized refund rejection and audit trail logging | **PASSED** |
| **AT-09** | Unverified custom domain rejection | **PASSED** |
| **AT-10** | Verified donation payment with 80G sequential receipt | **PASSED** |
| **AT-11** | Connection pool reuse tenant context reset | **PASSED** |
| **AT-12** | Immutable financial record voiding audit trail | **PASSED** |
| **E2E** | Full Section 4 pilot workflow acceptance | **PASSED** |

---

## Deployment to Render

This project is ready for 1-click deployment on [Render](https://render.com/) using the included [`render.yaml`](./render.yaml).

Detailed instructions are available in [`docs/render-deployment.md`](./docs/render-deployment.md).
