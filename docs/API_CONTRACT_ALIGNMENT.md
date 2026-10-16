# FOCIT LMS - Frontend/Backend API Contract Alignment Document

**Version:** 1.0.0-draft  
**Authors:** Backend Lead & Engineering Team  
**Audience:** Frontend Lead, UI/UX Developers, Backend Developers  
**Status:** Under Joint Review  

---

## 1. Global Conventions & Standards

### 1.1 Base URL & Versioning
All backend endpoints are versioned with the `/api/v1` prefix:
* **Local Development:** `http://localhost:5000/api/v1`
* **Staging / Production:** `https://api.focit.uniosun.edu.ng/api/v1`

---

### 1.2 Unified Response Envelope
Every response returned by the backend conforms to a predictable JSON envelope. The frontend client does not need different parsing logic across different modules.

#### Successful Response
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```
*(The `meta` object is optional and included primarily for paginated list endpoints).*

#### Error Response
```json
{
  "success": false,
  "error": {
    "code": "PREREQUISITE_NOT_MET",
    "message": "You must pass CSC 201 before registering for CSC 301.",
    "details": [
      {
        "field": "courses[2]",
        "message": "Prerequisite CSC 201 missing"
      }
    ]
  }
}
```

---

### 1.3 HTTP Status Codes
| Code | Meaning | When Used |
| :--- | :--- | :--- |
| `200 OK` | Request succeeded | Standard GET, PUT, PATCH responses. |
| `201 Created` | Resource created | Successful registration submission, announcement created. |
| `400 Bad Request` | Malformed payload | Zod validation failure, invalid JSON body. |
| `401 Unauthorized` | Unauthenticated | Missing, expired, or invalid token/session. |
| `403 Forbidden` | Access denied | User is logged in but lacks role/resource scope (e.g., student accessing HOD page). |
| `404 Not Found` | Resource missing | Course, material, or user does not exist. |
| `409 Conflict` | State conflict | Duplicate registration, duplicate course code. |
| `422 Unprocessable` | Business rule failed | Unit limit exceeded, registration window closed. |
| `502 / 503` | Upstream failure | Moodle Web Services temporarily unreachable. |

---

### 1.4 Identifiers & Types
* All primary entity IDs (`userId`, `studentId`, `offeringId`, `registrationId`) are represented as **UUID v4 strings** (e.g., `"c3b5d278-87a1-433b-8c6e-63f58a361bc4"`).
* Timestamps are returned in ISO 8601 UTC format (e.g., `"2026-10-15T09:30:00.000Z"`).

---

### 1.5 Authentication Transport & Cookies
* Authentication will use **`HttpOnly`, `SameSite=Lax`, `Secure` cookies** storing a signed JWT session.
* **Axios Configuration Requirement:** The frontend Axios client must be configured with:
  ```ts
  axios.defaults.withCredentials = true;
  ```
* This prevents cross-site scripting (XSS) from reading the authentication token from `localStorage`.

---

## 2. Authentication & Identity Endpoints

### 2.1 Login
* **Endpoint:** `POST /api/v1/auth/login`
* **Access:** Public
* **Request Body:**
  ```json
  {
    "identifier": "UNIOSUN/2023/CSC/042", // Accepts matric number, staff ID, or institutional email
    "password": "UserPassword123!"
  }
  ```
* **Response `data` (200 OK):**
  ```json
  {
    "user": {
      "id": "u-uuid-123",
      "email": "adebayo.t@uniosun.edu.ng",
      "firstName": "Adebayo",
      "lastName": "Taiwo",
      "role": "STUDENT",
      "department": {
        "id": "dept-uuid-01",
        "name": "Computer Science",
        "code": "CSC"
      },
      "level": 300,
      "matricNumber": "UNIOSUN/2023/CSC/042"
    }
  }
  ```
* *(Sets `focit_session` cookie automatically).*

---

### 2.2 Get Current Authenticated Profile
* **Endpoint:** `GET /api/v1/auth/me`
* **Access:** Authenticated (any role)
* **Purpose:** Called by the React application on startup / page refresh to restore authentication state.
* **Response `data` (200 OK):** Same user object as Login. If cookie is missing or invalid, returns `401 Unauthorized`.

---

### 2.3 Logout
* **Endpoint:** `POST /api/v1/auth/logout`
* **Access:** Authenticated
* **Purpose:** Clears the cookie and invalidates the session in Redis.
* **Response:** `{ "success": true, "data": { "message": "Logged out successfully" } }`

---

## 3. Academic Catalogue & Offerings

### 3.1 List Course Offerings (for Registration)
* **Endpoint:** `GET /api/v1/courses/offerings`
* **Access:** Authenticated
* **Query Parameters:**
  * `departmentId` *(optional, defaults to student's department)*
  * `level` *(optional, e.g. `300`)*
  * `semester` *(optional, `FIRST` or `SECOND`, defaults to active semester)*
* **Response `data` (200 OK):**
  ```json
  [
    {
      "offeringId": "off-uuid-001",
      "course": {
        "id": "crs-uuid-101",
        "code": "CSC 301",
        "title": "Operating Systems I",
        "creditUnits": 3,
        "isElective": false,
        "prerequisites": ["CSC 201"]
      },
      "academicSession": "2026/2027",
      "semester": "FIRST",
      "lecturers": [
        {
          "id": "staff-uuid-10",
          "name": "Dr. O. Babalola",
          "email": "o.babalola@uniosun.edu.ng"
        }
      ],
      "capacity": 150,
      "enrolledCount": 112
    }
  ]
  ```

---

## 4. Official Course Registration (The Academic Core)

### 4.1 Get My Registrations
* **Endpoint:** `GET /api/v1/registrations/me`
* **Access:** Authenticated (Student)
* **Query Parameters:** `academicSession` (optional), `semester` (optional)
* **Response `data` (200 OK):**
  ```json
  {
    "registrationId": "reg-uuid-999",
    "academicSession": "2026/2027",
    "semester": "FIRST",
    "status": "APPROVED",            // DRAFT | PENDING_APPROVAL | APPROVED | REJECTED | CANCELLED
    "moodleSyncStatus": "SYNCED",     // PENDING | PROCESSING | SYNCED | RETRYING | FAILED
    "totalUnits": 19,
    "courses": [
      {
        "offeringId": "off-uuid-001",
        "code": "CSC 301",
        "title": "Operating Systems I",
        "creditUnits": 3,
        "status": "APPROVED"
      }
    ],
    "approvedAt": "2026-10-15T10:00:00Z",
    "approvedBy": "Prof. A. Adegoke (HOD)"
  }
  ```
> **Frontend Note:** Display both `status` (academic status) and `moodleSyncStatus` (learning portal sync). If `status` is `APPROVED` but `moodleSyncStatus` is `PENDING`, show a badge: *"Registration Approved (Enrolment Syncing...)"*.

---

### 4.2 Submit Course Registration
* **Endpoint:** `POST /api/v1/registrations`
* **Access:** Authenticated (Student)
* **Request Body:**
  ```json
  {
    "offeringIds": [
      "off-uuid-001",
      "off-uuid-002",
      "off-uuid-003"
    ]
  }
  ```
* **Validation Rules:**
  * Checks that total credit units are $\ge 15$ and $\le 24$.
  * Checks that registration window is active.
  * Checks that all prerequisites are completed.
* **Response `data` (201 Created):** Returns the newly created registration object with status `PENDING_APPROVAL` or `APPROVED` (per institutional rule).

---

### 4.3 Approve Course Registration (HOD / Level Advisor)
* **Endpoint:** `POST /api/v1/registrations/:registrationId/approve`
* **Access:** Authenticated (Role: `HOD` or `LECTURER` with Advisor Scope)
* **Response `data` (200 OK):**
  ```json
  {
    "registrationId": "reg-uuid-999",
    "status": "APPROVED",
    "moodleSyncStatus": "PENDING"
  }
  ```
*(This action automatically triggers the transactional outbox worker to enrol the student in Moodle).*

---

## 5. Course Materials & Secure File Proxy (Resolving the Repo Mismatch)

### 5.1 List Course Materials
* **Endpoint:** `GET /api/v1/courses/:offeringId/materials`
* **Access:** Authenticated (Student enrolled in offering, or assigned Lecturer)
* **Response `data` (200 OK):**
  ```json
  {
    "courseOfferingId": "off-uuid-001",
    "courseCode": "CSC 301",
    "sections": [
      {
        "sectionId": 1,
        "title": "Module 1: Introduction to Kernel Architectures",
        "summary": "Overview of monolithic vs microkernels.",
        "materials": [
          {
            "id": "mat-uuid-101",
            "name": "Lecture 1 Slides - Kernel Basics.pdf",
            "type": "file",
            "mimeType": "application/pdf",
            "filesize": 2450000,
            "downloadUrl": "/api/v1/files/mat-uuid-101"
          },
          {
            "id": "act-uuid-201",
            "name": "Lab Exercise 1 - System Calls",
            "type": "assignment",
            "dueDate": "2026-10-25T23:59:00Z"
          }
        ]
      }
    ]
  }
  ```

---

### 5.2 Stream / Download Material File
* **Endpoint:** `GET /api/v1/files/:fileId`
* **Access:** Authenticated
* **Behavior:**
  1. The backend checks if the requesting user is enrolled in the course that owns `:fileId`.
  2. If unauthorized, returns `403 Forbidden`.
  3. If authorized, the backend securely pipes the file stream from Moodle storage with appropriate `Content-Type: application/pdf` and `Content-Disposition: inline` headers.
* **Frontend Usage:** The React PDF viewer can directly set `<iframe src="/api/v1/files/:fileId" />` or pass the URL into `react-pdf`. No sensitive tokens are exposed to the browser.

---

## 6. Learning Activity & Gradebook Facade

### 6.1 Get Student Course Grades
* **Endpoint:** `GET /api/v1/courses/:offeringId/grades`
* **Access:** Authenticated (Student for own grades, or assigned Lecturer)
* **Response `data` (200 OK):**
  ```json
  {
    "courseOfferingId": "off-uuid-001",
    "courseCode": "CSC 301",
    "gradeItems": [
      {
        "name": "Quiz 1 - Memory Management",
        "weight": "10%",
        "grade": 8.5,
        "maxGrade": 10.0,
        "feedback": "Good grasp of paging concepts."
      },
      {
        "name": "Mid-Semester Assignment",
        "weight": "20%",
        "grade": 17.0,
        "maxGrade": 20.0,
        "feedback": null
      }
    ],
    "totalContinuousAssessment": {
      "score": 25.5,
      "maxScore": 30.0,
      "percentage": 85.0
    }
  }
  ```

---

## 7. Role-Specific Dashboard Aggregators

Instead of making 5–8 individual HTTP requests when a user lands on their home screen, the frontend calls a single aggregator endpoint:

### 7.1 Student Dashboard
* **Endpoint:** `GET /api/v1/dashboards/student`
* **Access:** Role: `STUDENT`
* **Response `data` (200 OK):**
  ```json
  {
    "summary": {
      "academicSession": "2026/2027",
      "semester": "FIRST",
      "registeredUnits": 21,
      "maximumAllowedUnits": 24,
      "registrationStatus": "APPROVED",
      "moodleSyncStatus": "SYNCED"
    },
    "enrolledCourses": [
      {
        "offeringId": "off-uuid-001",
        "code": "CSC 301",
        "title": "Operating Systems I",
        "creditUnits": 3,
        "lecturerName": "Dr. O. Babalola",
        "nextClass": "Monday 10:00 AM - Lab 2"
      }
    ],
    "upcomingDeadlines": [
      {
        "courseCode": "CSC 301",
        "title": "Assignment 1",
        "dueDate": "2026-10-20T23:59:00Z"
      }
    ],
    "recentAnnouncements": [
      {
        "id": "ann-uuid-1",
        "title": "Faculty Orientation Schedule",
        "author": "Dean's Office",
        "date": "2026-10-14T08:00:00Z"
      }
    ]
  }
  ```

---

### 7.2 Lecturer Dashboard
* **Endpoint:** `GET /api/v1/dashboards/lecturer`
* **Access:** Role: `LECTURER`
* **Response `data` (200 OK):**
  ```json
  {
    "assignedCourses": [
      {
        "offeringId": "off-uuid-001",
        "code": "CSC 301",
        "title": "Operating Systems I",
        "enrolledCount": 112,
        "semester": "FIRST"
      }
    ],
    "pendingSubmissionsCount": 14,
    "recentDepartmentNotices": [ ... ]
  }
  ```

---

### 7.3 HOD Dashboard
* **Endpoint:** `GET /api/v1/dashboards/hod`
* **Access:** Role: `HOD`
* **Response `data` (200 OK):**
  ```json
  {
    "department": "Software Engineering",
    "totalStudents": 420,
    "totalStaff": 18,
    "pendingRegistrationApprovals": 35,
    "unallocatedCourses": 2,
    "levelSummaries": [
      { "level": 100, "registeredCount": 98 },
      { "level": 200, "registeredCount": 104 },
      { "level": 300, "registeredCount": 110 },
      { "level": 400, "registeredCount": 108 }
    ]
  }
  ```

---

### 7.4 Dean Dashboard
* **Endpoint:** `GET /api/v1/dashboards/dean`
* **Access:** Role: `DEAN`
* **Response `data` (200 OK):**
  ```json
  {
    "faculty": "Faculty of Computing and Information Technology",
    "facultyTotalStudents": 2450,
    "facultyTotalStaff": 92,
    "departments": [
      { "code": "CSC", "name": "Computer Science", "studentCount": 510, "activeOfferings": 24 },
      { "code": "SWE", "name": "Software Engineering", "studentCount": 420, "activeOfferings": 22 },
      { "code": "CYB", "name": "Cyber Security", "studentCount": 380, "activeOfferings": 20 },
      { "code": "INF", "name": "Information Systems", "studentCount": 310, "activeOfferings": 18 },
      { "code": "ITE", "name": "Information Technology", "studentCount": 340, "activeOfferings": 18 },
      { "code": "DSC", "name": "Data Science", "studentCount": 260, "activeOfferings": 16 },
      { "code": "LIS", "name": "Library & Info Science", "studentCount": 230, "activeOfferings": 14 }
    ],
    "accreditationStatus": "In Compliance"
  }
  ```

---

## 8. Timetable & Announcements

### 8.1 Current User Timetable
* **Endpoint:** `GET /api/v1/timetable/me`
* **Access:** Authenticated
* **Response `data` (200 OK):**
  ```json
  [
    {
      "id": "tt-uuid-01",
      "courseCode": "CSC 301",
      "courseTitle": "Operating Systems I",
      "dayOfWeek": 1, // 1 = Monday, 5 = Friday
      "startTime": "09:00",
      "endTime": "11:00",
      "venue": "CSET Lecture Theatre A",
      "lecturerName": "Dr. O. Babalola"
    }
  ]
  ```

---

### 8.2 Announcements Feed
* **Endpoint:** `GET /api/v1/announcements`
* **Access:** Authenticated
* **Query Parameters:** `scope` (`FACULTY` | `DEPARTMENT` | `COURSE`)
* **Response `data` (200 OK):** List of announcements filtered automatically by the user's role and enrolled courses.
* **Publish Announcement:** `POST /api/v1/announcements`
  * Body: `{ "title": "...", "content": "...", "targetScope": "DEPARTMENT", "targetId": "dept-uuid-01" }`
  * Allowed: `DEAN` (Faculty), `HOD` (Department), `LECTURER` / `COURSE_REP` (Course offering).

---

## 9. Alignment Sign-Off Checklist

Before coding begins, both leads should confirm:
- [ ] **Cookie vs. Bearer Header:** Agree that frontend will use `withCredentials: true` with `HttpOnly` cookies.
- [ ] **File Route Resolution:** Agree that frontend calls `/api/v1/files/:fileId` instead of passing raw Moodle URLs.
- [ ] **Dual Registration Statuses:** Agree that UI will display both `status` (Academic) and `moodleSyncStatus` (Integration).
- [ ] **UUID Format:** Agree that all IDs are treated as strings on the React client.
- [ ] **Dashboard Aggregators:** Agree on using single `/api/v1/dashboards/:role` calls on initial dashboard load.
