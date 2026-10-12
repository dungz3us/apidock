# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (user said the stack "is not important"): TypeScript monorepo. `packages/apidock` is the npm package (Zod contract SDK, Express adapter, devtools server). `packages/ui` is a React 19 + Vite + Tailwind SPA, built into `packages/apidock/ui-dist` and served by the package. Docs tab embeds Scalar (`@scalar/api-reference-react`).

## Users

One team around one API, all using the same `/apidock` page:

- **Backend developers** writing the API: test endpoints quickly while coding and check that responses match the contract.
- **Frontend / mobile developers** consuming the API: read docs, try endpoints, use the mock server before the backend is ready.
- **QA / testers**: run scenarios, watch contract violations, run tests in CI.

Outside partners reading public docs are not a target audience.

## Product Purpose

ApiDock is a self-hosted, Apidog-style API devtools: docs, try-it-out client, mock server, environments, collections, contract and scenario testing, and API design (spec viewer, diff, design → contract codegen). It runs on the user's own server, either mounted inside a Node.js backend (`app.use('/apidock', apidock({ api }))`) or as a standalone Docker service pointed at any OpenAPI spec URL. Success: the team no longer needs Postman + Swagger UI + a separate mock tool, and the API contract stays the single source of truth.

## Positioning

Code-first: the contract is defined once in code (Zod, `defineApi`) and drives the OpenAPI spec, request validation, typed handlers, mocks and tests. Unlike SaaS tools, nothing leaves the user's infrastructure, and the devtools can observe real traffic for contract drift because the SDK runs inside the backend.

## Operating Context

- Used beside an editor and a terminal during development; frequent, short, repeated requests.
- Served from the API's own origin under a mount path (e.g. `/apidock/`), or from a Docker container on an internal network.
- Disabled by default in production; may be protected by basic auth.
- Data (history, environments, collections) is stored in `.apidock/` (self-gitignored) or a Docker volume.

## Capabilities and Constraints

- Phase 1 (built): Docs, Client (request builder + response viewer), history, server-side proxy with host allowlist and private-network blocking.
- Planned: mock server, environments with `{{variables}}` and secrets, collections, contract violations, auto contract run, scenarios, CLI for CI, spec viewer, breaking-change diff, design editor → TypeScript contract codegen.
- Node.js backends only for the SDK; any language can use the Docker mode with an OpenAPI 3.x spec (Swagger 2.0 not supported).
- UI language: English only.

## Brand Commitments

Name: ApiDock. No logo, palette or typeface exists yet.

## Evidence on Hand

None. No users, testimonials, benchmarks or screenshots exist; do not fabricate any.

## Product Principles

1. The contract is the source of truth; every screen reflects the spec, never a copy of it.
2. Speed of the request loop beats breadth of features: fill what can be filled from the spec, keep the last request one keystroke away.
3. Safe by default: secrets are masked, the proxy only calls allowed hosts, devtools stay off in production.
4. Self-hosted and portable: works embedded or standalone with the same UI.

## Accessibility & Inclusion

WCAG 2.2 AA is required: contrast, full keyboard operation, visible focus, labelled controls, reduced-motion support.
