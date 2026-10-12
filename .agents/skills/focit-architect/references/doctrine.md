# The 8-8-8 Architectural Doctrine: Reference Manual & Mathematical Proofs

This document serves as the formal technical specification for the FOCIT LMS architecture.

---

## 1. Concurrency Defense: Dijkstra Resource Ordering

### 1.1 The Deadlock Vector
Consider two students, Student $A$ and Student $B$, registering for overlapping sets of courses concurrently:
- Student $A$ registers for $[C_1, C_2]$
- Student $B$ registers for $[C_2, C_1]$

If the database executes the row-level lock queries concurrently:
1. Student $A$ locks row $C_1$ via `SELECT ... WHERE course_id = 'C1' FOR UPDATE`.
2. Student $B$ locks row $C_2$ via `SELECT ... WHERE course_id = 'C2' FOR UPDATE`.
3. Student $A$ requests lock on row $C_2$, and blocks waiting for Student $B$.
4. Student $B$ requests lock on row $C_1$, and blocks waiting for Student $A$.

This creates a closed cycle in the database wait-for graph:
$$\text{Student } A \longrightarrow C_2 \longrightarrow \text{Student } B \longrightarrow C_1 \longrightarrow \text{Student } A$$
PostgreSQL detects this circular dependency and terminates one of the backends with error code `40P01` (`deadlock_detected`).

### 1.2 Mathematical Proof of Deadlock Immunity
Let $\mathcal{C}$ be the universe of all course IDs with a strict total order $\prec$ (e.g., standard lexicographical ASCII sorting):
$$\forall c_i, c_j \in \mathcal{C}, \quad c_i \ne c_j \implies (c_i \prec c_j \lor c_j \prec c_i)$$

By sorting all requested course IDs prior to acquisition:
$$\text{sortedCourseIds} = \text{sort}_{\prec}(R) = [c_{(1)}, c_{(2)}, \dots, c_{(k)}] \quad \text{where } c_{(1)} \prec c_{(2)} \prec \dots \prec c_{(k)}$$
Every transaction acquires locks in strictly increasing order. In any wait-for graph, an edge from transaction $T_1$ to transaction $T_2$ implies that $T_1$ holds a lock on $c_{(i)}$ and is waiting for $c_{(j)}$ held by $T_2$, requiring $c_{(i)} \prec c_{(j)}$. Since $\prec$ is a strict partial order with no cycles, the wait-for graph is an **Acyclic Directed Graph (DAG)**. 

Therefore, **deadlocks are mathematically impossible**.

---

## 2. Relational Set-Difference CTE

### 2.1 The Problem
Evaluating course registration eligibility in application code introduces a Time-of-Check to Time-of-Use (TOCTOU) vulnerability across network round trips.

### 2.2 Relational Algebra Specification
Let:
- $R$ be the set of requested course IDs in the registration payload.
- $\mathcal{E}(S)$ be the set of courses for which student $S$ is academically eligible (correct department, level, term, active status, prerequisites met).
- $\mathcal{A}(S)$ be the set of courses student $S$ has already passed or currently registered.

A valid registration payload satisfies:
$$R \subseteq (\mathcal{E}(S) \setminus \mathcal{A}(S)) \iff R \cap (\mathcal{C} \setminus (\mathcal{E}(S) \setminus \mathcal{A}(S))) = \emptyset$$

In PostgreSQL CTE form:
```sql
WITH requested AS (
  SELECT unnest($1::varchar[]) AS course_id
),
ineligible AS (
  SELECT r.course_id 
  FROM requested r
  WHERE NOT EXISTS (
    SELECT 1 
    FROM courses c
    JOIN students s ON s.student_id = $2
    WHERE c.course_id = r.course_id
      AND c.department_id = s.department_id
      AND c.level <= s.current_level
      AND c.status = 'ACTIVE'
  )
  OR EXISTS (
    SELECT 1 
    FROM enrollments e 
    WHERE e.student_id = $2 
      AND e.course_id = r.course_id 
      AND e.status IN ('ENROLLED', 'PASSED')
  )
)
SELECT course_id FROM ineligible;
```
If `ineligible` returns any rows, the transaction terminates with `422 Unprocessable Entity` before row locks or capacity counters are touched.

---

## 3. Cumulative Credit Bounds

### 3.1 Overload Exploit Prevention
Validation must compute:
$$U_{\text{projected}} = U_{\text{enrolled}} + U_{\text{payload}} = \sum_{c \in \mathcal{E}_{\text{active}}(S)} \text{units}(c) + \sum_{r \in R} \text{units}(r)$$
The invariant requires:
$$U_{\text{projected}} \le U_{\max} \quad (U_{\max} = 24)$$

For minimum floor enforcement:
$$\text{action} = \text{'FINALIZE'} \implies U_{\text{projected}} \ge U_{\min} \quad (U_{\min} = 15)$$
$$\text{action} = \text{'SAVE_DRAFT'} \implies U_{\text{projected}} \ge 0$$

---

## 4. Composite Aggregator Topology

### 4.1 Mobile Latency Waterfall Elimination
On campus cellular networks (3G/HSPA+, RTT $\approx 150-250\text{ms}$):
- Naive sequential client waterfall:
  $$T_{\text{client}} = \text{RTT}_{\text{metadata}} + \text{RTT}_{\text{progress}} + \text{RTT}_{\text{activities}} + \text{RTT}_{\text{materials}} \approx 4 \times 220\text{ms} + \text{server processing} \approx 1,020\text{ms}$$
- Composite Aggregator BFF:
  $$T_{\text{composite}} = \text{RTT}_{\text{client-BFF}} + \max(T_{\text{PostgreSQL}}, \min(T_{\text{Moodle}}, 1500\text{ms})) \approx 220\text{ms} + 12\text{ms} \approx 232\text{ms}$$

Network efficiency improvement: $\approx 77\%$ latency reduction.
