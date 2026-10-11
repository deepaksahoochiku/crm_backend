# CRM Sales Management System — Backend API

A production-grade RESTful backend built with Node.js, Express, MongoDB, and Mongoose that manages the complete sales lifecycle: Lead Generation → Qualification → Customer Conversion → Pipeline Stages → Deal Closure.

---

## 1. Technologies Used
- **Runtime Environment:** Node.js (v18+)
- **Framework:** Express.js (v4.21.2)
- **Database:** MongoDB Atlas / Replica Set
- **ODM:** Mongoose (v8.9.5)
- **Authentication & Security:** JWT (jsonwebtoken), bcryptjs, Helmet, Express-Rate-Limit, CORS
- **Environment Config:** Dotenv

---

## 2. Architecture & Project Structure

```text
crm-backend/
├── src/
│   ├── config/
│   │   └── db.js                 # MongoDB connection
│   ├── constants/
│   │   └── enums.js              # Centralized frozen enums
│   ├── models/
│   │   ├── userModel.js          # User schema & hierarchy ref
│   │   ├── leadModel.js          # Leads schema
│   │   ├── customerModel.js      # Customers schema
│   │   ├── dealModel.js          # Deals & expected revenue
│   │   ├── activityModel.js      # Follow-ups, calls, meetings
│   │   └── timelineModel.js      # System audit log schema
│   ├── controllers/
│   │   ├── authController.js     # User management & authentication
│   │   ├── leadController.js     # Leads & ACID conversion engine
│   │   ├── customerController.js # Customers management
│   │   ├── dealController.js     # Deals & sales pipeline
│   │   ├── activityController.js # Activities & overdue calculation
│   │   ├── timelineController.js # Audit history retrieval
│   │   └── analyticsController.js# Dashboard summary & pipeline metrics
│   ├── routes/
│   │   ├── authRoutes.js         # /api/auth
│   │   ├── leadRoutes.js         # /api/leads
│   │   ├── customerRoutes.js     # /api/customers
│   │   ├── dealRoutes.js         # /api/deals
│   │   ├── activityRoutes.js     # /api/activities
│   │   ├── timelineRoutes.js     # /api/timeline
│   │   └── analyticsRoutes.js    # /api/dashboard & /api/analytics
│   ├── middlewares/
│   │   ├── authMiddleware.js     # JWT guard & role permissions
│   │   └── errorMiddleware.js    # Centralized error handler
│   ├── utils/
│   │   └── token.js              # JWT generator
│   ├── router.routes.js          # Central router joint
│   ├── app.js                    # Express app & security pipeline
│   └── server.js                 # Entry point
├── .env
├── .env.example
├── package.json
└── README.md
```

---

## 3. Environment Variables

Create a `.env` file in the root directory (refer to `.env.example`):

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/crm_database?retryWrites=true&w=majority
JWT_SECRET=crm_super_secure_jwt_secret_key_2026
JWT_EXPIRES_IN=1d
```

---

## 4. Installation & How to Run the Server

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (nodemon)
npm run dev

# 3. Run in production mode
npm start
```

---

## 5. Authentication & Security Mechanism

- **Password Hashing:** Passwords are automatically hashed using `bcryptjs` with salt rounds (10). User password field has `select: false` so it is never exposed in queries or API responses.
- **JWT Authorization:** Stateless Bearer tokens passed via the `Authorization: Bearer <token>` header, verified on protected routes.
- **Security Headers & Rate Limiting:** `helmet` for HTTP security headers, CORS enabled, and `express-rate-limit` (300 requests per 15-minute window) to prevent brute-force attacks.
- **Centralized Error Handling:** Standardized error responses with sensitive database internals and stack traces withheld in production.

---

## 6. User Roles & Permissions (RBAC)

1. **Admin:**
   - Single root admin bootstrap.
   - Global read, write, and deletion privileges across all CRM entities.
   - Reopen closed deals (`Won`/`Lost`), reassign managers, and view global team performance.

2. **Sales Manager:**
   - Scoped strictly to their own team (themselves and executives reporting directly to them).
   - Can create and manage sales executives in their team.
   - Assign and reassign leads, deals, and activities within their team.
   - View team-level performance analytics.

3. **Sales Executive:**
   - Scoped strictly to their own assigned leads, deals, customers, and activities.
   - Create leads, update assigned records, schedule follow-up activities, and view personal metrics.

---

## 7. Important Business Rules

1. **Atomic Lead Conversion (ACID Transactions):**
   - Only `Qualified` leads can be converted.
   - Uses MongoDB multi-document transactions (`session.withTransaction`) to atomically create a Customer, create a Deal, mark the Lead as `Converted`, and log 3 audit timeline events. Partial conversion is prevented.
   - A converted lead cannot be converted again.

2. **Deal Revenue Calculation:**
   - Whenever `dealValue` or `probability` changes:
     $$\text{expectedRevenue} = \frac{\text{dealValue} \times \text{probability}}{100}$$
   - Deal values must always be $> 0$ and probability must be $0 \le p \le 100$.

3. **Pipeline Stage Rules:**
   - Stages: `Qualification` ➔ `Discovery` ➔ `Proposal` ➔ `Negotiation` ➔ `Won` / `Lost`.
   - Marking a deal as `Lost` strictly requires a `lostReason`.
   - Closed deals (`Won`/`Lost`) cannot be reopened without Administrator authorization.

4. **Dynamic Overdue Tracking:**
   - An activity is dynamically evaluated as overdue if `dueDate < now` AND `status !== 'Completed'`.

5. **Audit Trail (Timeline):**
   - 15 critical CRM events are logged automatically with `action`, `entityType`, `entityId`, `performedBy`, `previousValue`, `newValue`, and `notes`.

---

## 8. Database Design & Indexing Decisions

- **Users:** Compound index `{ role: 1, isActive: 1 }` for fast authorization checks; index on `email`.
- **Leads:** Indexes on `{ assignedTo: 1 }`, `{ status: 1 }`, `{ priority: 1 }`, `{ createdAt: -1 }`.
- **Customers:** Indexes on `{ email: 1 }`, `{ assignedTo: 1 }`, `{ lead: 1 }`.
- **Deals:** Indexes on `{ customer: 1 }`, `{ assignedTo: 1 }`, `{ stage: 1 }`, `{ expectedClosingDate: 1 }`.
- **Activities:** Compound index `{ assignedTo: 1, status: 1 }`; index on `{ dueDate: 1 }`.
- **Timeline:** Compound index `{ entityId: 1, entityType: 1, createdAt: -1 }` for quick history lookup.

---

## 9. Assumptions Made

1. **Single Root Admin:** Only 1 Administrator exists in the system. The first admin is registered publicly without a token; subsequent user registrations require an authorized token.
2. **Team Hierarchy:** Sales Managers only manage the Sales Executives assigned to them via the `manager` field.
3. **Soft/Hard Deletes:** Deletion operations are restricted to Administrators (and Managers for activities) to maintain CRM data integrity.

---

## 10. API Endpoints Reference

Base URL prefix: `{{BASE_URL}}/api`

### 1. Authentication & Users (`/api/auth`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/auth/create-user` | Create user (Single-admin bootstrap; Manager/Executive requires token) | Public / Protected |
| `POST` | `/auth/login` | Authenticate and obtain JWT token | Public |
| `POST` | `/auth/logout` | Invalidate session | Protected |
| `GET` | `/auth/me` | Fetch current authenticated user profile | Protected |
| `GET` | `/auth/users` | List users with search, pagination, role filter | Admin / Manager |
| `GET` | `/auth/users/:id` | Get user profile by ID | Protected |
| `PUT` | `/auth/users/:id` | Update user details (hierarchy enforced) | Protected |
| `PATCH` | `/auth/users/:id/status` | Activate / deactivate user account | Admin / Manager |
| `PATCH` | `/auth/users/:id/manager`| Assign / reassign manager to executive | Admin |
| `DELETE`| `/auth/users/:id` | Delete user record | Admin |

### 2. Leads (`/api/leads`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/leads` | Create lead (auto-assigned for Executive) | Protected |
| `GET` | `/leads` | List leads (search, status, priority, source, date range, pagination) | Protected |
| `GET` | `/leads/:id` | Get single lead by ID | Protected |
| `PATCH`| `/leads/:id` | Update lead attributes | Protected |
| `PATCH`| `/leads/:id/status` | Update lead status (`New`, `Contacted`, `Qualified`, etc.) | Protected |
| `PATCH`| `/leads/:id/assign` | Assign / reassign lead to sales executive | Admin / Manager |
| `DELETE`| `/leads/:id` | Delete lead | Admin / Manager |
| `POST` | `/leads/:id/convert` | Atomic ACID Conversion: Customer + Deal + Lead marked Converted | Protected |

### 3. Customers (`/api/customers`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/customers` | Create standalone customer | Protected |
| `GET` | `/customers` | List customers (search, status filter, date range, pagination) | Protected |
| `GET` | `/customers/:id` | Get customer details by ID | Protected |
| `PUT` | `/customers/:id` | Update customer details | Protected |
| `DELETE`| `/customers/:id` | Delete customer | Admin |

### 4. Deals & Pipeline (`/api/deals`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/deals` | Create standalone deal | Protected |
| `GET` | `/deals` | List deals (stage filter, min/max value, closing date, search) | Protected |
| `GET` | `/deals/:id` | Get deal details with populated customer | Protected |
| `PUT` | `/deals/:id` | Update deal (auto recalculates `expectedRevenue`) | Protected |
| `PATCH`| `/deals/:id/stage` | Update stage (`Discovery` ➔ `Proposal` ➔ `Negotiation` ➔ `Won` / `Lost`) | Protected |
| `DELETE`| `/deals/:id` | Delete deal | Admin |

### 5. Sales Activities & Follow-ups (`/api/activities`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/activities` | Create activity (`Call`, `Email`, `Meeting`, `Demo`, `Follow-up`, `Reminder`, `Note`) | Protected |
| `GET` | `/activities` | List activities (type, status, overdue filter, date range, counts summary) | Protected |
| `GET` | `/activities/:id` | Get activity details | Protected |
| `PUT` | `/activities/:id` | Update activity schedule / notes | Protected |
| `PATCH`| `/activities/:id/complete`| Mark activity completed (records `completedAt` & logs timeline) | Protected |
| `DELETE`| `/activities/:id` | Delete activity | Admin / Manager |

### 6. Timeline / Audit History (`/api/timeline`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/timeline/Lead/:leadId` | Audit history for specific lead | Protected |
| `GET` | `/timeline/Deal/:dealId` | Audit history for specific deal | Protected |
| `GET` | `/timeline/Customer/:customerId` | Audit history for specific customer | Protected |
| `GET` | `/timeline` | Global activity feed with pagination | Protected |

### 7. Pipeline Analytics & Dashboard (`/api/dashboard`)
| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/dashboard` | Role-scoped KPI summary: conversion rate, pipeline values, win rate, team leaderboard | Protected |
| `GET` | `/analytics/pipeline`| Sales pipeline velocity & stage breakdown report | Protected |
