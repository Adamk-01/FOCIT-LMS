# Lecturer Service

This directory contains the independent **Lecturer Service** for the FOCIT LMS ecosystem.

## Structure
- `frontend/`: React SPA containing the Lecturer Workspace, Course Roster with CA CSV Ingestion, 4-Mode Attendance Suite, and Test-First Question Bank.
- `backend/`: Express API microservice managing lecturer courses, student grades, attendance passcodes, assignments, and test question banks.

## Database Connection
Configured to connect to the dedicated Neon Lecturer database:
```env
LECTURER_DATABASE_URL=postgres://.../focit_lecturer?sslmode=require
```

## Vercel Deployment
To deploy the Lecturer Dashboard independently:
- **Project Name:** `focit-lecturer`
- **Root Directory:** `lecturer/frontend`
