/**
 * Mock Moodle Course Data
 *
 * This replicates the exact JSON shape returned by Moodle's
 * `core_course_get_contents` Web Services API function.
 *
 * Reference: https://docs.moodle.org/dev/Web_service_API_functions
 *
 * Structure:
 * - A course contains sections (Week 1, Week 2, etc.)
 * - Each section contains modules (resources, URLs, etc.)
 * - Each module contains contents (files with download URLs)
 */
export const courses = {
  // Course ID 1: CSC 204 — Data Structures and Algorithms
  1: [
    {
      id: 100,
      name: 'Week 1 — Introduction to Data Structures',
      summary: '<p>Overview of fundamental data structures and their applications in computer science.</p>',
      visible: 1,
      modules: [
        {
          id: 1001,
          name: 'Week 1 — Introduction to Data Structures',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Comprehensive introduction to data structures including arrays, linked lists, and abstract data types.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'CSC215_Lecture_Slides.pdf',
              filepath: '/',
              filesize: 292158,
              mimetype: 'application/pdf',
              timemodified: 1693526400,
              fileurl: 'http://localhost:3001/static/CSC215_Lecture_Slides.pdf',
            },
          ],
        },
        {
          id: 1002,
          name: 'Lecture 1 Video',
          modname: 'url',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/url',
          description: 'Video lecture covering Week 1 topics.',
          visible: 1,
          contents: [
            {
              type: 'url',
              filename: 'YouTube',
              filepath: '/',
              filesize: 0,
              mimetype: 'text/html',
              timemodified: 1693526400,
              fileurl: 'https://www.youtube.com/watch?v=example1',
            },
          ],
        },
      ],
    },
    {
      id: 101,
      name: 'Week 2 — Arrays and Lists',
      summary: '<p>Deep dive into arrays, dynamic arrays, and linked list implementations.</p>',
      visible: 1,
      modules: [
        {
          id: 1003,
          name: 'Lecture 2 — Linked Lists',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Singly linked lists, doubly linked lists, and circular linked lists with implementation examples.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'Linked_Lists.pdf',
              filepath: '/',
              filesize: 1_800_000,
              mimetype: 'application/pdf',
              timemodified: 1694131200,
              fileurl: 'http://localhost:3001/pluginfile.php/1003/Linked_Lists.pdf?token=mock_token',
            },
          ],
        },
        {
          id: 1004,
          name: 'External Resource — Java Documentation',
          modname: 'url',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/url',
          description: 'Official Java documentation for the Collections framework.',
          visible: 1,
          contents: [
            {
              type: 'url',
              filename: 'Link',
              filepath: '/',
              filesize: 0,
              mimetype: 'text/html',
              timemodified: 1694131200,
              fileurl: 'https://docs.oracle.com/javase/8/docs/api/java/util/Collections.html',
            },
          ],
        },
      ],
    },
    {
      id: 102,
      name: 'Week 3 — Stacks and Queues',
      summary: '<p>Stack and queue data structures with real-world applications.</p>',
      visible: 1,
      modules: [
        {
          id: 1005,
          name: 'Lecture 3 — Stacks and Queues',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Stack operations (push, pop, peek), queue operations (enqueue, dequeue), and their applications in expression evaluation and BFS.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'Stacks_and_Queues.pdf',
              filepath: '/',
              filesize: 3_200_000,
              mimetype: 'application/pdf',
              timemodified: 1694736000,
              fileurl: 'http://localhost:3001/pluginfile.php/1005/Stacks_and_Queues.pdf?token=mock_token',
            },
          ],
        },
      ],
    },
    {
      id: 103,
      name: 'Week 4 — Trees and Binary Search Trees',
      summary: '<p>Tree traversals, BST operations, and balanced trees.</p>',
      visible: 1,
      modules: [
        {
          id: 1006,
          name: 'Lecture 4 — Trees',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Binary trees, BST insertion/deletion/search, tree traversals (inorder, preorder, postorder), and AVL trees.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'Trees_and_BST.pdf',
              filepath: '/',
              filesize: 4_100_000,
              mimetype: 'application/pdf',
              timemodified: 1695340800,
              fileurl: 'http://localhost:3001/pluginfile.php/1006/Trees_and_BST.pdf?token=mock_token',
            },
          ],
        },
        {
          id: 1007,
          name: 'Lab Exercise — BST Implementation',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Hands-on lab: implement a BST in Java with insert, delete, and search operations.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'BST_Lab_Exercise.pdf',
              filepath: '/',
              filesize: 890_000,
              mimetype: 'application/pdf',
              timemodified: 1695340800,
              fileurl: 'http://localhost:3001/pluginfile.php/1007/BST_Lab_Exercise.pdf?token=mock_token',
            },
          ],
        },
      ],
    },
  ],

  // Course ID 2: CSC 202 — Object Oriented Programming
  2: [
    {
      id: 200,
      name: 'Week 1 — OOP Fundamentals',
      summary: '<p>Introduction to object-oriented programming concepts.</p>',
      visible: 1,
      modules: [
        {
          id: 2001,
          name: 'OOP Fundamentals Lecture Notes',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Classes, objects, encapsulation, and abstraction.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'OOP_Fundamentals.pdf',
              filepath: '/',
              filesize: 2_100_000,
              mimetype: 'application/pdf',
              timemodified: 1693526400,
              fileurl: 'http://localhost:3001/pluginfile.php/2001/OOP_Fundamentals.pdf?token=mock_token',
            },
          ],
        },
      ],
    },
    {
      id: 201,
      name: 'Week 2 — Inheritance and Polymorphism',
      summary: '<p>Advanced OOP: inheritance hierarchies and polymorphic behavior.</p>',
      visible: 1,
      modules: [
        {
          id: 2002,
          name: 'Inheritance and Polymorphism',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Single inheritance, method overriding, abstract classes, and interfaces.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'Inheritance_Polymorphism.pdf',
              filepath: '/',
              filesize: 1_950_000,
              mimetype: 'application/pdf',
              timemodified: 1694131200,
              fileurl: 'http://localhost:3001/pluginfile.php/2002/Inheritance_Polymorphism.pdf?token=mock_token',
            },
          ],
        },
      ],
    },
  ],

  // Course ID 3: MTH 101 — Calculus I
  3: [
    {
      id: 300,
      name: 'Week 1 — Limits and Continuity',
      summary: '<p>Introduction to limits, one-sided limits, and continuity.</p>',
      visible: 1,
      modules: [
        {
          id: 3001,
          name: 'Limits and Continuity Notes',
          modname: 'resource',
          modicon: 'https://moodle.example.com/theme/image.php/boost/core/1/f/pdf',
          description: 'Definition of limits, limit laws, squeeze theorem, and continuity.',
          visible: 1,
          contents: [
            {
              type: 'file',
              filename: 'Limits_and_Continuity.pdf',
              filepath: '/',
              filesize: 3_500_000,
              mimetype: 'application/pdf',
              timemodified: 1693526400,
              fileurl: 'http://localhost:3001/pluginfile.php/3001/Limits_and_Continuity.pdf?token=mock_token',
            },
          ],
        },
      ],
    },
  ],
};
