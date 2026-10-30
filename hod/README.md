# HOD (Head of Department) Service

This directory contains the independent **HOD Academic Governance Service** for the FOCIT LMS ecosystem.

## Structure
- `frontend/`: React SPA containing the HOD Academic Governance Desk, interactive lecturer course allocation matrix, and finance-portfolio cohort analytics terminal.
- `backend/`: Express API microservice managing lecturer course assignments and departmental cohort performance analytics.

## Database Connection
Configured to connect to the dedicated Neon HOD database:
```env
HOD_DATABASE_URL=postgres://.../focit_hod?sslmode=require
```

## Vercel Deployment
To deploy the HOD Dashboard independently:
- **Project Name:** `focit-hod`
- **Root Directory:** `hod/frontend`
