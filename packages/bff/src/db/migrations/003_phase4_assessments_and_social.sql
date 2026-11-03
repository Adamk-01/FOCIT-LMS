-- ==============================================================================
-- FOCIT LMS - Phase 4 Assessments & Social Modules Schema + Seed Script
-- Modules: Quizzes (Screen 4), Gradebook (Screen 6), Discussion Forum (Screen 7)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. QUIZZES & QUESTION BANK (Screen 4 Engine)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quizzes (
    quiz_id VARCHAR(32) PRIMARY KEY,
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    title VARCHAR(128) NOT NULL,
    description TEXT,
    duration_minutes INT NOT NULL DEFAULT 45,
    total_points NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    question_id VARCHAR(32) PRIMARY KEY,
    quiz_id VARCHAR(32) NOT NULL REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
    question_number INT NOT NULL,
    prompt TEXT NOT NULL,
    options JSONB NOT NULL, -- Array of { id: string, text: string }
    correct_option_id VARCHAR(32) NOT NULL,
    points NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_quiz_question_num UNIQUE (quiz_id, question_number)
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions (quiz_id);

-- ------------------------------------------------------------------------------
-- 2. QUIZ ATTEMPTS & ANSWERS (The High-Stakes State Machine)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_attempts (
    attempt_id VARCHAR(32) PRIMARY KEY,
    quiz_id VARCHAR(32) NOT NULL REFERENCES quizzes(quiz_id) ON DELETE RESTRICT,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED')),
    score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    total_points NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE,
    submission_mode VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_attempt_student_quiz UNIQUE (student_id, quiz_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts (student_id, quiz_id);

CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
    attempt_id VARCHAR(32) NOT NULL REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
    question_id VARCHAR(32) NOT NULL REFERENCES quiz_questions(question_id) ON DELETE RESTRICT,
    selected_option_id VARCHAR(32) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (attempt_id, question_id)
);

-- ------------------------------------------------------------------------------
-- 3. DURABLE TRANSACTIONAL OUTBOX (Deadlock-Free Sweeper Schema)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    delivery_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    worker_id VARCHAR(64),
    idempotency_key VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_outbox_sweeper 
ON outbox_events (status, locked_until, created_at) 
WHERE status IN ('PENDING', 'PROCESSING');

-- ------------------------------------------------------------------------------
-- 4. GRADEBOOK LEDGER (Screen 6 Engine)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grade_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    item_name VARCHAR(128) NOT NULL,
    category VARCHAR(32) NOT NULL CHECK (category IN ('QUIZ', 'ASSIGNMENT', 'MIDTERM', 'FINAL_EXAM')),
    weight_percent INT NOT NULL CHECK (weight_percent >= 0 AND weight_percent <= 100),
    grade NUMERIC(5, 2) NOT NULL,
    max_grade NUMERIC(5, 2) NOT NULL,
    percentage INT NOT NULL,
    letter_grade VARCHAR(4) NOT NULL,
    feedback TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'GRADED',
    graded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_items_student 
ON grade_items (course_id, student_id);

-- ------------------------------------------------------------------------------
-- 5. DISCUSSION FORUM LEDGER (Screen 7 Engine)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_threads (
    thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    author_name VARCHAR(128) NOT NULL,
    author_role VARCHAR(32) NOT NULL DEFAULT 'STUDENT',
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    replies_count INT NOT NULL DEFAULT 0,
    last_post_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_threads_course 
ON forum_threads (course_id, last_post_at DESC);

-- ------------------------------------------------------------------------------
-- SEED DATA: CSC 204 Quiz 1, Gradebook items, and Forum threads
-- ------------------------------------------------------------------------------

-- Seed Quiz
INSERT INTO quizzes (quiz_id, course_id, title, description, duration_minutes, total_points, status, due_date)
VALUES (
    'quiz_csc204_1',
    'CSC204',
    'Quiz 1: Data Structures, Arrays & Linked Lists',
    'Covers asymptotic Big-O runtime analysis, array traversal memory layout, and singly vs doubly linked list operations.',
    45,
    10.00,
    'ACTIVE',
    NOW() + INTERVAL '7 days'
) ON CONFLICT (quiz_id) DO NOTHING;

-- Seed 10 Questions matching Screen 4 in ui_template.jpeg
INSERT INTO quiz_questions (question_id, quiz_id, question_number, prompt, options, correct_option_id, points)
VALUES
(
    'q_csc204_1',
    'quiz_csc204_1',
    1,
    'What is the worst-case time complexity of searching for an element in an unsorted array of size N?',
    '[{"id":"opt_a","text":"O(1)"},{"id":"opt_b","text":"O(log N)"},{"id":"opt_c","text":"O(N)"},{"id":"opt_d","text":"O(N log N)"}]'::jsonb,
    'opt_c',
    1.00
),
(
    'q_csc204_2',
    'quiz_csc204_1',
    2,
    'Which of the following data structures provides constant time O(1) insertion at the beginning of the sequence?',
    '[{"id":"opt_a","text":"Standard Dynamic Array"},{"id":"opt_b","text":"Singly Linked List with head pointer"},{"id":"opt_c","text":"Binary Search Tree"},{"id":"opt_d","text":"Sorted Array"}]'::jsonb,
    'opt_b',
    1.00
),
(
    'q_csc204_3',
    'quiz_csc204_1',
    3,
    'In a circular queue implemented using an array of size N with front and rear pointers, the condition for the queue being full is:',
    '[{"id":"opt_a","text":"front == rear"},{"id":"opt_b","text":"(rear + 1) % N == front"},{"id":"opt_c","text":"rear == N - 1"},{"id":"opt_d","text":"front == (rear + 1)"}]'::jsonb,
    'opt_b',
    1.00
),
(
    'q_csc204_4',
    'quiz_csc204_1',
    4,
    'What is the auxiliary space complexity of an in-place array reversal algorithm?',
    '[{"id":"opt_a","text":"O(1)"},{"id":"opt_b","text":"O(N)"},{"id":"opt_c","text":"O(log N)"},{"id":"opt_d","text":"O(N^2)"}]'::jsonb,
    'opt_a',
    1.00
),
(
    'q_csc204_5',
    'quiz_csc204_1',
    5,
    'Which traversal of a Binary Search Tree (BST) visits nodes in non-decreasing sorted numerical order?',
    '[{"id":"opt_a","text":"Pre-order traversal"},{"id":"opt_b","text":"In-order traversal"},{"id":"opt_c","text":"Post-order traversal"},{"id":"opt_d","text":"Level-order traversal"}]'::jsonb,
    'opt_b',
    1.00
),
(
    'q_csc204_6',
    'quiz_csc204_1',
    6,
    'What is the maximum number of nodes in a binary tree of depth D (where root is at depth 0)?',
    '[{"id":"opt_a","text":"2^D"},{"id":"opt_b","text":"2^(D+1) - 1"},{"id":"opt_c","text":"2^(D-1) + 1"},{"id":"opt_d","text":"2D"}]'::jsonb,
    'opt_b',
    1.00
),
(
    'q_csc204_7',
    'quiz_csc204_1',
    7,
    'What collision resolution strategy in Hash Tables links colliding keys into an auxiliary chain structure?',
    '[{"id":"opt_a","text":"Linear Probing"},{"id":"opt_b","text":"Quadratic Probing"},{"id":"opt_c","text":"Separate Chaining"},{"id":"opt_d","text":"Double Hashing"}]'::jsonb,
    'opt_c',
    1.00
),
(
    'q_csc204_8',
    'quiz_csc204_1',
    8,
    'In a Min-Heap with N elements, what is the time complexity to extract the minimum element and restore the heap property?',
    '[{"id":"opt_a","text":"O(1)"},{"id":"opt_b","text":"O(log N)"},{"id":"opt_c","text":"O(N)"},{"id":"opt_d","text":"O(N log N)"}]'::jsonb,
    'opt_b',
    1.00
),
(
    'q_csc204_9',
    'quiz_csc204_1',
    9,
    'Which algorithm is used to find the shortest path in a weighted graph with non-negative edge weights?',
    '[{"id":"opt_a","text":"Bellman-Ford Algorithm"},{"id":"opt_b","text":"Dijkstra''s Algorithm"},{"id":"opt_c","text":"Kruskal''s Algorithm"},{"id":"opt_d","text":"Floyd-Warshall Algorithm"}]'::jsonb,
    'opt_b',
    1.00
),
(
    'q_csc204_10',
    'quiz_csc204_1',
    10,
    'What is the worst-case time complexity of QuickSort when the pivot chosen is always the maximum or minimum element?',
    '[{"id":"opt_a","text":"O(N log N)"},{"id":"opt_b","text":"O(N)"},{"id":"opt_c","text":"O(N^2)"},{"id":"opt_d","text":"O(2^N)"}]'::jsonb,
    'opt_c',
    1.00
) ON CONFLICT (quiz_id, question_number) DO NOTHING;

-- Seed an Active Quiz Attempt for John Doe (student1)
INSERT INTO quiz_attempts (attempt_id, quiz_id, student_id, status, score, total_points, started_at, due_at)
VALUES (
    'att_csc204_john',
    'quiz_csc204_1',
    'student1',
    'IN_PROGRESS',
    0.00,
    10.00,
    NOW(),
    NOW() + INTERVAL '45 minutes'
) ON CONFLICT (student_id, quiz_id) DO NOTHING;

-- Seed initial Answer for Question 1 so Question 1 shows as answered
INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_id, updated_at)
VALUES ('att_csc204_john', 'q_csc204_1', 'opt_c', NOW())
ON CONFLICT (attempt_id, question_id) DO NOTHING;

-- Seed Gradebook items for student1 (Screen 6 in ui_template.jpeg)
INSERT INTO grade_items (course_id, student_id, item_name, category, weight_percent, grade, max_grade, percentage, letter_grade, feedback)
VALUES
(
    'CSC204',
    'student1',
    'Quiz 1: Arrays and Linked Lists',
    'QUIZ',
    10,
    9.00,
    10.00,
    90,
    'A',
    'Excellent understanding of asymptotic complexity and pointers.'
),
(
    'CSC204',
    'student1',
    'Assignment 1: Memory Layout & Stack Implementation',
    'ASSIGNMENT',
    15,
    14.00,
    15.00,
    93,
    'A',
    'Clean memory management and unit test suite.'
),
(
    'CSC204',
    'student1',
    'Quiz 2: Trees & Priority Queues',
    'QUIZ',
    10,
    8.50,
    10.00,
    85,
    'A',
    'Solid grasp of balancing and heap properties.'
),
(
    'CSC204',
    'student1',
    'Midterm Examination',
    'MIDTERM',
    25,
    22.00,
    25.00,
    88,
    'A',
    'Strong theoretical foundations.'
) ON CONFLICT DO NOTHING;

-- Seed Discussion Threads for CSC 204 (Screen 7 in ui_template.jpeg)
INSERT INTO forum_threads (course_id, student_id, author_name, author_role, title, body, replies_count, last_post_at)
VALUES
(
    'CSC204',
    'student1',
    'Dr. K. A. Adebayo',
    'LECTURER',
    'Week 4 Lab: Balancing Binary Search Trees (AVL)',
    'Students should review tree rotations before attending Tuesday morning practicals in the IT Lab 2.',
    8,
    NOW() - INTERVAL '2 hours'
),
(
    'CSC204',
    'student1',
    'Adebayo Samuel',
    'STUDENT',
    'Clarification on Dijkstra vs A* heuristic bounds',
    'Can someone clarify why Dijkstra is considered an uninformed search variant of A* when the heuristic h(n) = 0?',
    4,
    NOW() - INTERVAL '5 hours'
),
(
    'CSC204',
    'student1',
    'Oluwaseun Bakare',
    'STUDENT',
    'Study Group for Midterm Review: Harmattan Session',
    'Meeting at FOCIT Library Common Room on Friday at 3:00 PM for Big-O derivations.',
    12,
    NOW() - INTERVAL '1 day'
) ON CONFLICT DO NOTHING;

COMMIT;
