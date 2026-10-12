# Phase 5 Implementation Plan: Lecturer Manual Question Bank (Screen 5)
**Author:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** Pending Authorization  
**Target Screen:** Screen 5 (Lecturer Question Bank & Manual Authoring Engine)  
**Standard Enforced:** The 8-8-8 Architectural Doctrine (`focit-architect`)

---

## 1. Executive Architectural Blueprint

Phase 5 introduces the Lecturer Authoring Engine for the FOCIT LMS. While students interact with quizzes as read-and-append consumers, lecturers interact as content producers. The central engineering challenge is **decoupling lecturer write-intent from high-volume student attempt ingestion**.

```
+-----------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER (V8)                                  |
|  +--------------------------------+                  +-------------------------------+  |
|  |     Filter & Search State      |                  |   Optimistic Draft Authoring  |  |
|  | URL SearchParams: ?type=&q=    |                  |  Form FSM: IDLE -> SAVING     |  |
|  +---------------+----------------+                  +---------------+---------------+  |
+------------------|---------------------------------------------------|------------------+
                   |                                                   |
                   v                                                   v
+-----------------------------------------------------------------------------------------+
|                                  EXPRESS BFF GATEWAY                                    |
|  +-----------------------------------------------------------------------------------+  |
|  |  Role Gate: Lecturer Authorization Middleware (role === 'LECTURER' | 'ADMIN')     |  |
|  |  COW Engine: Decoupled revision branching (V_k sealed -> V_{k+1} draft)           |  |
|  +-----------------------------------------+-----------------------------------------+  |
+--------------------------------------------|--------------------------------------------+
                                             |
                      +----------------------+----------------------+
                      | (Student Traffic)                           | (Lecturer Traffic)
                      | FOR KEY SHARE                               | FOR NO KEY UPDATE
                      v                                             v
+-------------------------------------------+ +-------------------------------------------+
|          Student Ingestion Plane          | |          Lecturer Authoring Plane         |
|  INSERT INTO quiz_attempts                | |  INSERT INTO quiz_questions (V_{k+1})     |
|  - Reads frozen active revision V_k       | |  - Mutates unsealed draft revision        |
|  - Zero lock contention with authoring    | |  - Promotes via non-key pointer swap      |
+-------------------------------------------+ +-------------------------------------------+
```

---

## 2. Decoupled Concurrency Architecture: Eliminating the `FOR UPDATE` Bottleneck

### 2.1 The PostgreSQL Lock Matrix Conflict
When a student starts an exam:
$$\text{INSERT INTO } \texttt{quiz\_attempts} \, (\texttt{quiz\_id}, \dots) \implies \text{PostgreSQL acquires } \mathbf{FOR\ KEY\ SHARE} \text{ on parent } \texttt{quizzes}$$

Acquiring `FOR UPDATE` on `quizzes` during lecturer edits triggers an immediate deadlock and serialization bottleneck:
$$\mathbf{FOR\ UPDATE} \otimes \mathbf{FOR\ KEY\ SHARE} = \mathbf{CONFLICT}$$

All 200 incoming student attempts queue behind the lecturer's transaction.

### 2.2 The Refactored Solution: Principle of Published Immutability & Non-Key Pointer Swaps

#### Invariant 1: Published Quizzes are Immutable by Definition
Once a quiz transitions to `status = 'ACTIVE'`, its question bank is **physically sealed**. In-place modification is rejected at the protocol level. All lecturer edit requests branch to a new independent tuple:
$$\text{Quiz Revision } V_{k+1} = \text{clone}(V_k)$$

Because $V_{k+1}$ has a distinct primary key (`quiz_id = 'quiz_csc204_v2'`), authoring queries on $V_{k+1}$ touch completely separate table rows and index pages, resulting in **zero lock overlap** with student attempts running against $V_k$.

#### Invariant 2: Non-Key Atomic Pointer Swap (`FOR NO KEY UPDATE`)
A course points to its active assessment via `is_active_for_new_attempts = TRUE` (or an active pointer table). When promoting $V_{k+1}$ to active:

```sql
BEGIN;

-- 1. Deactivate V_k (Acquires FOR NO KEY UPDATE, NOT FOR UPDATE)
UPDATE quizzes 
SET is_active_for_new_attempts = FALSE 
WHERE quiz_id = $1_old;

-- 2. Activate V_{k+1}
UPDATE quizzes 
SET is_active_for_new_attempts = TRUE,
    status = 'ACTIVE'
WHERE quiz_id = $2_new;

COMMIT;
```

#### Mathematical Compatibility:
$$\mathbf{FOR\ NO\ KEY\ UPDATE} \circ \mathbf{FOR\ KEY\ SHARE} = \mathbf{COMPATIBLE}$$
Students can insert new rows into `quiz_attempts` simultaneously while the pointer swap transaction executes, with **zero milliseconds of lock wait time**.

---

## 3. Database Schema: Referential Integrity & Question Bank Engine

```sql
-- 1. Quizzes Table with Immutable Revision Tracking
CREATE TABLE IF NOT EXISTS quizzes (
    quiz_id VARCHAR(32) PRIMARY KEY,
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
    title VARCHAR(128) NOT NULL,
    description TEXT,
    duration_minutes INT NOT NULL DEFAULT 45,
    total_points NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
    version INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    is_active_for_new_attempts BOOLEAN NOT NULL DEFAULT FALSE,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_course_active_quiz UNIQUE (course_id, is_active_for_new_attempts) 
        -- Partial unique index enforced where is_active_for_new_attempts = TRUE
);

-- 2. Question Bank with Native Engine-Level Integrity Constraint
CREATE TABLE IF NOT EXISTS quiz_questions (
    question_id VARCHAR(32) PRIMARY KEY,
    quiz_id VARCHAR(32) NOT NULL REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
    question_number INT NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'MULTIPLE_CHOICE' CHECK (type IN ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER')),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL, -- Array of { id: string, text: string }
    correct_option_id VARCHAR(32) NOT NULL,
    points NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Absolute Referential Integrity Invariant:
    -- Guaranteed by the database engine: correct_option_id MUST exist in options JSONB array
    CONSTRAINT chk_correct_option_exists_in_options 
        CHECK (options @> jsonb_build_array(jsonb_build_object('id', correct_option_id))),
    
    CONSTRAINT uq_quiz_question_num UNIQUE (quiz_id, question_number)
);

-- 3. Engine-Level Trigger: Blocks in-place mutation on active/attempted quizzes
CREATE OR REPLACE FUNCTION trg_enforce_quiz_question_immutability()
RETURNS TRIGGER AS $$
DECLARE
    attempts_count INT;
BEGIN
    SELECT COUNT(*) INTO attempts_count
    FROM quiz_attempts
    WHERE quiz_id = OLD.quiz_id;

    IF attempts_count > 0 THEN
        RAISE EXCEPTION 'Academic Integrity Invariant: Cannot mutate question % while parent quiz % has recorded student attempts. Create a revision instead.',
            OLD.question_id, OLD.quiz_id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quiz_question_immutability_guard
BEFORE UPDATE OR DELETE ON quiz_questions
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_quiz_question_immutability();
```

---

## 4. Screen 5: Lecturer View UI Specification (Matching `ui_template.jpeg`)

### 4.1 Top Metric Cards
- **Total Questions in Bank:** e.g. `10 Active Questions`
- **Assessment Type Breakdown:**
  - Multiple Choice: 8
  - True/False: 1
  - Short Answer: 1
- **Current Published Revision:** `Version 1.0 (Live • 45 Mins)`

### 4.2 Question Filter Chips
- Horizontal scrolling pill tabs:
  - `All Types`
  - `Multiple Choice`
  - `True / False`
  - `Short Answer`

### 4.3 Manual Question Authoring Card
- **Form Layout:**
  - Question Prompt textarea with character count
  - Question Type dropdown (`MULTIPLE_CHOICE`, `TRUE_FALSE`, `SHORT_ANSWER`)
  - Points input (`1.00 - 10.00`)
  - Dynamic Option Editor:
    - 4 text inputs for Options A, B, C, D
    - Radio button on each row allowing the lecturer to select the authoritative `correct_option_id`
    - Live client-side validation ensuring the correct option is selected before submission
  - Submit Button with mutation lock: `Save Question to Bank`

### 4.4 Questions Table & Revision Actions
- Table displaying:
  - `#`
  - `Question Prompt & Snippet`
  - `Type Badge`
  - `Options Summary` (highlighting the correct answer in emerald green)
  - `Points`
  - `Actions`: `Edit` (branches to draft revision if active), `Duplicate`, `Delete`

---

## 5. Implementation Milestones

1. **Milestone 5.1: BFF Backend Endpoints**
   - `packages/bff/src/routes/questionBank.js`:
     - `GET /api/courses/:courseId/question-bank`: Retrieves all questions and active revision status.
     - `POST /api/courses/:courseId/question-bank/questions`: Creates a manual question with `@>` constraint validation.
     - `POST /api/courses/:courseId/question-bank/revise`: Clones active quiz to draft revision ($V_{k+1}$) for zero-downtime editing.
     - `POST /api/courses/:courseId/question-bank/publish`: Executes the atomic `FOR NO KEY UPDATE` pointer swap.

2. **Milestone 5.2: Frontend Components**
   - `packages/frontend/src/pages/QuestionBankPage.jsx` (Screen 5):
     - Filter chip state linked to URL search parameters (`?type=MULTIPLE_CHOICE`).
     - Dynamic option authoring form with radial correct answer binder.
     - Question list table with type badges and action menus.
     - Revision Banner displaying live attempt isolation status.

3. **Milestone 5.3: Routing & Integration**
   - Register `/courses/:courseId/question-bank` in `router.jsx`.
   - Embed within Lecturer Mode in `ProtectedLayout` / navigation.
   - Run production bundle compilation check (`npm run build -w packages/frontend`).
