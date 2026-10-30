# Student Service (Maintained by Opeyemi)

This directory contains the independent **Student Service** for the FOCIT LMS ecosystem.

## Structure
- `frontend/`: React SPA containing the Student Academic Dashboard (`DashboardPage.jsx` at baseline `83c6a3e`), Course Registration, Gradebook, and Quiz Attempt engine.
- `backend/`: Express API microservice managing student telemetry, course registration state machine, and CBT test attempts.

## Database Connection
Configured to connect to the dedicated Neon Student database:
```env
STUDENT_DATABASE_URL=postgres://.../focit_student?sslmode=require
```

## Vercel Deployment
To deploy the Student Dashboard independently:
- **Project Name:** `focit-student`
- **Root Directory:** `student/frontend`
