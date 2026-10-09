# FOCIT LMS

A Learning Management System (LMS) module for managing and rendering learning materials, acting as an abstraction layer over a Headless Moodle instance.

## Architecture

This project is a monorepo structured with NPM Workspaces containing three packages:

1. **packages/frontend (React + Vite)**: A dynamic, responsive UI for displaying courses and materials. Built with React 19, React Router, and Tailwind CSS.
2. **packages/bff (Express)**: A Backend-for-Frontend proxy that handles routing, caching, and rate-limiting before talking to Moodle.
3. **packages/mock-moodle (Express)**: A mock API server that mimics the Moodle web service endpoints for local development.

## Getting Started

### Prerequisites
* Node.js >= 20.0.0
* Docker & Docker Compose (optional, for full DB/Redis support)

### Installation
From the root of the project, install all workspace dependencies:
`ash
npm install
`

### Running Locally (Without Docker)

You can run the entire stack concurrently using the built-in NPM workspace scripts:

`ash
# Start all workspaces (Frontend, BFF, Mock Moodle) concurrently
npm run dev

# Alternatively, run them individually in separate terminals:
npm run dev:mock
npm run dev:bff
npm run dev:frontend
`

The frontend will be available at http://localhost:5173.

### Running Locally (With Docker)

To run the stack with PostgreSQL and Redis support (for caching and DB in the BFF layer):
`ash
docker-compose up -d
`

## Features
* **Concurrent UI Updates:** Utilizes React's useDeferredValue and AbortController to prevent race conditions during rapid search input.
* **Resilient Architecture:** Global concurrency gates and robust rate limiters implemented in the BFF proxy.
* **Premium UI/UX:** A beautifully designed frontend incorporating glassmorphism, responsive grid layouts, and skeleton loaders.

## Deployment Guidelines
* Ensure environment variables are properly set in the BFF (PORT, DATABASE_URL, REDIS_URL, MOODLE_URL).
* Use 
pm run build within packages/frontend to generate static assets for your CDN or Nginx server.
* The BFF should be deployed on a Node environment (e.g., AWS Elastic Beanstalk, Docker container, or Vercel).
