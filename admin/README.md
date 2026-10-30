# Admin Service

This directory contains the independent **Admin Service** for the FOCIT LMS ecosystem.

## Structure
- `frontend/`: React SPA containing all Admin pages (Admin Dashboard, Users, Outbox Queue, Audit Ledger, Profile), components, and hooks.
- `backend/`: Express API microservice handling administrative provisioning, account status modifications, audit log retrieval, and Moodle outbox monitoring.

## Database Connection
Configured to connect to the dedicated Neon Admin database:
```env
ADMIN_DATABASE_URL=postgres://.../focit_admin?sslmode=require
```

## Vercel Deployment
To deploy the Admin Dashboard independently:
- **Project Name:** `focit-admin`
- **Root Directory:** `admin/frontend`
