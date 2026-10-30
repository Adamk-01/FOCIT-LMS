-- Migration 015: Digital Library Taxonomy, Textbooks, Past Questions, Metrics & Audit
-- Staff-Level Systems Architecture: Hot-Row Contention Elimination & B-Tree Null Clustering
BEGIN;

-- 1. Taxonomy Categories
CREATE TABLE IF NOT EXISTS library_categories (
    id VARCHAR(32) PRIMARY KEY, -- 'courses', 'textbooks', 'past_questions', 'faculty_resources'
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    icon_name VARCHAR(64) NOT NULL DEFAULT 'BookOpen',
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed core taxonomy categories
INSERT INTO library_categories (id, slug, name, description, icon_name, display_order)
VALUES 
  ('courses', 'courses', 'Course Materials', 'Lecture notes, slide decks, and lab handouts organized by enrolled courses and faculty catalog', 'FolderOpen', 1),
  ('textbooks', 'textbooks', 'Textbooks & E-Books', 'Approved textbooks, reference monographs, and computing literature', 'BookOpen', 2),
  ('past_questions', 'past-questions', 'Past Questions Vault', 'Official UNIOSUN semester examination and test papers spanning past academic sessions', 'FileCheck', 3),
  ('faculty_resources', 'resources', 'Faculty Resources', 'Departmental handbooks, SIWES guidelines, FYP LaTeX templates, and academic policies', 'Award', 4)
ON CONFLICT (id) DO NOTHING;

-- 2. Library Items Repository (Authoritative Metadata Ledger)
CREATE TABLE IF NOT EXISTS library_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id VARCHAR(32) NOT NULL REFERENCES library_categories(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    author VARCHAR(255),
    publisher VARCHAR(255),
    publication_year INT,
    edition VARCHAR(64),
    isbn VARCHAR(32),
    
    -- Academic Dimensions
    course_id VARCHAR(32) REFERENCES courses(course_id) ON DELETE SET NULL,
    department_id VARCHAR(32) REFERENCES departments(id) ON DELETE SET NULL,
    level INT CHECK (level IN (100, 200, 300, 400, 500)),
    academic_session VARCHAR(32), -- e.g., '2023/2024', '2024/2025'
    semester_number INT CHECK (semester_number IN (1, 2)), -- 1 = Harmattan, 2 = Rain
    
    -- Item Classification
    item_type VARCHAR(64) NOT NULL CHECK (
        item_type IN (
            'LECTURE_NOTE', 
            'LAB_MANUAL', 
            'TEXTBOOK', 
            'REFERENCE_BOOK', 
            'SEMESTER_EXAM_PQ', 
            'MIDTERM_TEST_PQ', 
            'HANDBOOK', 
            'RESEARCH_TEMPLATE', 
            'CURRICULUM_GUIDE', 
            'POLICY_DOCUMENT'
        )
    ),
    
    -- File Storage & Binary Metadata
    file_url VARCHAR(1024) NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
    page_count INT DEFAULT NULL,
    cover_image_url VARCHAR(1024) DEFAULT NULL,
    
    -- Security & Publication Status (Zero-Day Exam Embargo Quarantine)
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    embargo_until TIMESTAMPTZ DEFAULT NULL,
    uploaded_by VARCHAR(64) DEFAULT 'faculty_admin',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Search vector (English stemming)
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', 
            title || ' ' || 
            COALESCE(description, '') || ' ' || 
            COALESCE(author, '') || ' ' || 
            COALESCE(publisher, '') || ' ' || 
            COALESCE(course_id, '') || ' ' || 
            COALESCE(academic_session, '')
        )
    ) STORED
);

-- 3. Narrow Fixed-Width Metrics Ledger (Heap-Only Tuples / HOT Optimized)
-- Decouples volatile counters from wide library_items to prevent WAL write amplification & GIN index churn
CREATE TABLE IF NOT EXISTS library_item_metrics (
    item_id UUID PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
    view_count BIGINT NOT NULL DEFAULT 0,
    download_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Append-Only Audit Ledger
CREATE TABLE IF NOT EXISTS library_downloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('VIEW', 'DOWNLOAD')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. High-Selectivity B-Tree & GIN Indexes (Clustered with NULLS FIRST)
CREATE INDEX IF NOT EXISTS idx_library_items_category_published 
    ON library_items (category_id, embargo_until ASC NULLS FIRST, created_at DESC)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_course 
    ON library_items (course_id) 
    WHERE course_id IS NOT NULL AND is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_pq_lookup 
    ON library_items (category_id, academic_session, semester_number, level, course_id, embargo_until ASC NULLS FIRST)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_textbooks 
    ON library_items (category_id, department_id, level, embargo_until ASC NULLS FIRST)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_search_vector 
    ON library_items USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_library_downloads_item_created 
    ON library_downloads (item_id, created_at DESC);

COMMIT;
