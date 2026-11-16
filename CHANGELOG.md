# Changelog

All notable changes to the Cloudflare Access Training Evaluator project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0] - 2026-11-16

A security and reliability release: the admin gate now verifies the Access token, the Okta sync can no longer silently lose or merge identities, and the admin dashboard is rebuilt with real Kumo components. **Read the upgrade notes first.**

### Upgrade notes (breaking)

- **Evaluation now matches on the full email.** The email in the Access identity must equal the stored Okta login (`primary_email`), case-insensitive. Before, only the part before the `@` was compared, so `alice@a.com` and `alice@b.com` shared one status. A user whose stored email is missing or different is now denied, and an email that matches several rows is denied. Check with: `SELECT username, primary_email FROM users WHERE primary_email IS NULL OR lower(primary_email) NOT LIKE username || '@%'`.
- **Service tokens cannot open the admin UI.** The admin gate needs a verified Access JWT with an `email` claim, and service-token JWTs carry none.
- **Rotate the RSA signing key.** A version before this one wrote the private key to the Worker logs. Removing the log line does not remove old log records. See the README, Step 6.
- **API response changes:** `GET /api/okta/groups` returns `{id, name, description, type, created}` per group instead of the nested `profile` object (and no longer invents `lastUpdated` or `_links`); `POST /api/okta/sync` returns HTTP 207 with `success: false` when the results contain errors; `POST /api/update-training` returns 400 for malformed input and 413 for bodies over 10 KB (was 500).
- **Routing is exact-match.** Unknown paths return 404 and a wrong method returns 405 with `Allow`. Before, any path ending in `/keys` or `/init-db` matched, and every other request fell through to the evaluation handler. `GET /keys` and `POST /` (used by the Access external-evaluation rule) are unchanged.
- **Cloudflare Access application:** it must cover `/admin*`, `/api/*` and `/init-db`. `/dashboard`, `/dashboard/` and `/init-db/` are aliases and need not be covered.

### Added

- **Admin dashboard rebuilt with real `@cloudflare/kumo` components** (React, bundled with Vite and embedded in the Worker, 605 KiB JS and 102 KiB CSS): stat cards with a completion meter, status tabs with counts, search, a sortable table, pagination, row selection, and a confirmation dialog before any grant or revoke. Light and dark themes. Only server-confirmed changes are shown; a failed edit reverts, a partly failed bulk update keeps the failed rows selected, and a sync that finishes with errors is shown as a partial failure and the data is reloaded.
- **Server-side origin (CSRF) check** (`src/auth/origin.ts`) on every state-changing admin request, after authentication.
- **Test suite:** Vitest with 514 tests and a D1 fake that runs the real SQL through `node:sqlite`. Covers the access rule, JWT verification, CSP, routing, the origin check, Okta pagination and transactional sync, update validation, and the dashboard's API client.
- **Tooling:** type-aware ESLint 10 flat config (`src/`, `ui/`, `tests/`), type-checking of the tests, a generated `Env` type (`npm run types`), and `AGENTS.md`.
- **Key provisioning:** `scripts/generate-signing-keys.mjs` creates a key pair locally with owner-only permissions, no network calls and no secrets on stdout.
- **CI:** a monthly keepalive workflow so GitHub does not disable the required Semgrep check after 60 days of inactivity, and Dependabot for GitHub Actions (grouped, monthly, 7-day cooldown).

### Changed

- **Admin authentication verifies the Access JWT.** The RS256 signature is checked against the team keys, `exp` is required, `iss` is pinned to `https://TEAM_DOMAIN`, and `aud` must match `ACCESS_APP_AUD`. The unsigned `CF-Access-Jwt-Payload` header is no longer trusted, and base64url tokens containing `-` or `_` now work.
- **Evaluation token:** only RS256 is accepted, and `exp` is required. A token whose `iss` differs from `https://TEAM_DOMAIN` is logged as a warning but still accepted, because its signature was already verified against your team's keys.
- **Okta sync reconciles by identity.** A username that exists with a different email is reported as an identity conflict and is never updated, inherited or deleted. Two directory users that share a username are both skipped. A sync updates only `first_name` (never `primary_email` or `training_status`) and never inserts a user whose email already belongs to another row.
- **Sync safety:** writes run in transactional batches of at most 100, and a failed batch stops the later phases. Deletion runs only for a full-directory sync that finished with no errors, never for an empty directory, and never for users whose Okta login could not be parsed. Group syncs add and update only. Syncs read fresh data instead of the 10-minute cache.
- **Okta requests** use `redirect: 'manual'` and reject any redirect, so the API token is never re-sent to another URL. Pagination links must match the Okta origin including the port, with no embedded credentials. `groupId` is validated before any Okta call.
- **Sync responses** return a generic message on failure, with details only in the Worker logs. `fetchOktaGroups` is paginated.
- **The CSP is always strict** (no `unsafe-inline`). `DEBUG` never changes it and is parsed strictly (the string `"false"` is not debug). Security headers, with nonces where needed, are now on every response, including the 401, 403, 404 and 405 pages.
- **Config:** `compatibility_date` is 2026-11-01 (smoke-tested on the local runtime), observability sampling and source maps are enabled, and dependencies are updated, including Wrangler 4.163 and the Workers types 5 (`npm audit`: 0 vulnerabilities).
- **CI:** Semgrep now scans TypeScript and flags only unguarded `JSON.parse`, every GitHub Action is pinned to a full commit SHA, and `upload-sarif` is v4.
- The release workflow builds its "Full Changelog" compare link from the previous tag instead of subtracting 1 from the patch number, which produced `v4.0.-1` for a `.0` release.

### Security

- The RSA signing private key is no longer written to the logs (see the upgrade notes).
- The `x-script-nonce`, `x-style-nonce` and `x-content-version` response headers that exposed page nonces are removed.
- Okta pagination compares the full origin, not just the hostname.

### Removed

- Unused code: the API-key auth stub (`shouldUseApiKeyAuth`), unused database and type-guard helpers, `reportCSPViolation`, the unused metrics and type definitions (`src/types/handlers.ts` and others), and the duplicate friendly page in the evaluation handler.

### Fixed

- **Okta sync no longer deletes users beyond the first page.** `fetchOktaUsers` read a single page (`limit=200`) and ignored Okta's `Link: rel="next"` header, while `syncUsersToDatabase` deletes every database user missing from the list it receives. On tenants with more than 200 users, everyone past the first page was treated as removed from Okta and deleted on the next sync.
  - New `fetchOktaPages` helper follows `rel="next"` links for both the all-users and the group-users fetches
  - The full combined list is cached (same 10-minute TTL), so a cache hit never returns a partial list
  - Any failed page, unexpected payload, or non-`OKTA_DOMAIN` / non-HTTPS pagination link throws, so a partial list never reaches the delete step and the API token is never sent to another host
  - Hard cap of 50 pages (10,000 users at 200 per page); exceeding it throws instead of truncating
- A group-scoped sync no longer deletes every user outside the group.
- Okta sync errors, and `POST /api/update-training` with malformed input, no longer return 500 or `success: true`.

## [3.0.0] - 2026-04-29

### Added

- **Dark / Light mode** across all four UI pages (Admin Dashboard, System Overview, External Eval fallback, Access Denied)
  - Theme toggle button (moon/sun SVG) on every page
  - Flash-prevention inline script sets `data-mode` on `<html>` before first paint
  - Preference persisted to `localStorage`; respects `prefers-color-scheme` as default
- **Kumo design system** — full UI rebuild using Cloudflare's Kumo semantic token system
  - CSS custom property token set: surfaces (`canvas → base → tint`), text hierarchy, status colours, borders, shadows, radius scale
  - `[data-mode="dark"]` overrides redefine all tokens for dark mode with no additional class logic
  - Admin Dashboard: sticky page header with CF logo dot, stat cards, pill-style status selects, clean table with uppercase column headers, bulk-actions dark bar
  - Card pages (System Overview, Access Denied, External Eval): centred card layout with orange/red header bar, endpoint method badges, status banners, notice boxes

### Changed

- Replaced all bespoke CSS with Kumo-compatible token-driven styles across `src/handlers/web.ts`, `src/handlers/index.ts`, and `src/auth/admin.ts`
- Removed dark gradient background; replaced with neutral `--kumo-canvas` surface
- Status badges replaced with `badge-success` / `badge-danger` pill components with animated dot
- Bulk-actions bar now uses semi-transparent rgba tokens so it renders correctly in both modes
- Warning notice text now uses `var(--kumo-warning)` token instead of hard-coded amber hex
- Wrangler updated from `4.28.0` → `4.86.0`
- Worker route `training-status.macharpe.com/*` added to `wrangler.jsonc`

### Fixed

- CSP `buildCSPHeader` / `createCSPHeaders` / `addCSPHeaders` updated to accept `string | string[] | null` for `scriptNonces`, enabling multiple inline script nonces per response without generating invalid CSP directives
- Dark mode flash-prevention script now correctly allowlisted via its own nonce in the CSP `script-src` directive

### Security

- Flash-prevention init script uses a dedicated nonce, correctly included in the CSP `script-src` alongside the main script nonce — no `unsafe-inline` required

## [2.1.0] - 2025-10-21

### Added

- Hybrid cache optimization with Workers Cache API for admin dashboard
- Cache headers for JWKS public keys endpoint (`/keys`)
- Cache headers for system overview page (`/`)
- ExecutionContext support in fetch handler for cache operations
- Cache status indicators (`x-cache-status: HIT/MISS`) for monitoring

### Changed

- Admin dashboard now uses Workers Cache API with 30-second TTL
- JWKS endpoint cached for 1 hour (browser) / 2 hours (edge)
- System overview page cached for 5 minutes (browser) / 10 minutes (edge)
- Reduced worker invocations by ~90% for cached endpoints
- Reduced D1 database queries by ~60% for admin dashboard

### Performance

- `/keys` endpoint: ~95% reduction in worker invocations (~50ms → ~2ms latency)
- `/` endpoint: ~90% reduction in worker invocations (~200ms → ~20ms latency)
- `/admin` endpoint: ~40% reduction in worker invocations (~400ms → ~80ms latency)
- Significant cost reduction through edge caching and reduced KV/D1 operations

## [2.0.0] - 2025-10-09

### Changed

- Complete TypeScript migration with strict type checking (#32)
- Migrated all 16 JavaScript source files to TypeScript
- Added comprehensive type definitions across 37 files (+6,128/-3,040 lines)
- Implemented 20+ interface definitions for data structures
- Added runtime type guards for validation
- Configured strict TypeScript compiler options (noImplicitAny, strictNullChecks)
- Enhanced code maintainability and developer experience with full IDE support
- Updated build pipeline with TypeScript compilation
- Added ESLint with TypeScript-specific rules
- Zero type errors with complete type safety throughout codebase

### Added

- TypeScript configuration (tsconfig.json)
- ESLint configuration for TypeScript (.eslintrc.json)
- 3 new type definition files (types/index.ts, types/handlers.ts, types/guards.ts)
- Generic types for reusable components (CacheEntry<T>, D1Result<T>)
- Proper Web Crypto API type annotations
- Updated dashboard screenshot reflecting latest admin interface (#33)

### Technical Details

**Migrated Modules:**

- Utilities: encoding, validation, cache, logging
- Database: D1 operations with typed queries
- Authentication: admin, access, evaluation, keys, JWT
- Security: Content Security Policy
- Integrations: Okta API with typed responses
- Handlers: index, sync, web
- Entry point: type-safe routing

**Note:** This is a major internal refactoring with no breaking changes for end users. All functionality preserved with added type safety.

## [1.5.0] - 2025-09-30

### Changed

- Improved web interface button styling and color consistency (#30)
- Updated CTA buttons to use gradient styling matching table headers
- Applied CSS variables for better maintainability
- Enhanced visual harmony across the interface

## [1.4.0] - 2025-09-12

### Fixed

- Resolved critical External Evaluation routing issue (#28)
- Fixed POST request handling on root path for JWT token processing
- Corrected Clear Filters button alignment in admin dashboard
- Added proper method differentiation between GET (overview) and POST (evaluation) requests

### Added

- System overview page at root endpoint with comprehensive documentation
- Animated system status indicator
- Available endpoints documentation
- Gateway-style design consistency

### Changed

- Added MIT License file (#27)
- Added mailmap configuration for consolidated commit attribution (#29)

## [1.3.0] - 2025-09-12

### Added

- Comprehensive Gateway-style design system implementation (#26)
- Professional dark theme with Cloudflare orange accents
- Modern card-based layout with enhanced shadows and spacing
- Responsive grid layouts with refined breakpoints
- CSS custom properties system for consistent styling
- Enhanced table styling with gradients and professional typography
- Modern button styling with hover states and loading indicators

### Changed

- Updated dashboard screenshot to reflect new professional appearance
- Improved mobile responsiveness across all components
- Enhanced accessibility with better focus states

## [1.2.0] - 2025-08-22

### Security

- Implemented comprehensive CSP security framework (#25)
- Added enterprise-grade Content Security Policy with nonce-based protection
- Implemented environment-aware CSP policies (strict production/permissive development)
- Added complete security headers suite (X-Frame-Options, X-Content-Type-Options, etc.)
- Fixed unsafe format string usage identified by Semgrep scans
- Added cryptographic nonce generation using Web Crypto API
- Implemented XSS attack prevention and clickjacking protection

### Fixed

- Resolved Semgrep log injection security vulnerabilities (#21)
- Replaced unsafe string interpolation in console logging
- Fixed CWE-134 unsafe format string vulnerabilities

### Changed

- Enhanced README with comprehensive security documentation

## [1.1.0] - 2025-08-22

### Performance

- Completed comprehensive optimization suite (#24)
- Achieved 60-90% reduction in external API calls through intelligent caching
- Optimized JWT key lookup with early termination using find()
- Redesigned database operations with Map-based lookups and batch processing
- Implemented intelligent caching system with TTL (Access keys: 5min, Okta users: 10min, groups: 30min)
- Enhanced string concatenation performance in base64url encoding
- Made Okta API limits configurable via OKTA_FETCH_LIMIT

### Security

- Added comprehensive input validation framework with RFC 5322 email validation
- Implemented production-safe error responses with sanitized logging
- Enhanced JWT processing with domain validation
- Added log injection prevention and secure data sanitization

### Added

- Structured logging framework with JSON format
- Comprehensive metrics tracking (requests, auth, database, cache, Okta operations)
- Performance monitoring with request duration and endpoint usage analytics
- Cache hit/miss tracking and statistics
- Comprehensive JSDoc documentation

### Changed

- Created modular utility system (validation, cache, logging)
- Improved code organization and separation of concerns

## [1.0.0] - 2025-08-21

### Security

- Enhanced RSA key security by separating private keys from KV storage (#23)
- Moved RSA private keys from Workers KV to encrypted Workers Secrets
- Maintained public keys in KV for Cloudflare Access signature verification
- Updated JWT signing to load private keys from RSA_PRIVATE_KEY secret

### Added

- Comprehensive migration guide for existing deployments
- RSA key setup documentation with initial and migration workflows
- Enhanced production security checklist with key management best practices
- Updated security architecture diagram with Workers Secrets integration

### Changed

- Improved error handling for missing or invalid private key secrets

## [0.9.0] - 2025-08-19

### Added

- Detailed authentication workflow diagram to README (#22)
- Comprehensive mermaid sequence diagram illustrating 14-step authentication flow
- Documentation of dual RSA key pair strategy (Access keys + Worker keys)
- Bidirectional JWT verification process visualization
- Key management strategy documentation

### Changed

- Reorganized Security Flow section for better clarity

## [0.8.1] - 2025-08-18

### Fixed

- Added missing GitHub Actions permissions for PR comments
- Resolved HttpError 403 when Semgrep tries to comment on PRs
- Added issues:write and pull-requests:write permissions to workflow

## [0.8.0] - 2025-08-18

### Added

- Two-way Okta user synchronization (#20)
- Automatic user removal from database when deleted from Okta
- Sync statistics tracking (added, updated, removed counts)

### Security

- Disabled preview URLs and workers.dev public access
- Enhanced production security posture

### Changed

- Updated documentation to reflect bidirectional sync capabilities

## [0.7.0] - 2025-08-13

### Changed

- Improved KV namespace naming for better clarity (#19)
- Updated KV namespace from 'KV' to 'external-auth-keys'
- Enhanced self-documentation through descriptive naming

## [0.6.0] - 2025-08-08

### Security

- Removed ADMIN_API_KEY authentication (#18)
- Migrated to pure Cloudflare Access authentication
- Eliminated hybrid authentication system
- Simplified authentication model with complete audit trail

### Changed

- Updated all admin endpoints to require Cloudflare Access only
- Removed API key fallback logic
- Simplified Access application configuration
- Updated documentation to reflect Access-only model

### Removed

- ADMIN_API_KEY secret no longer used or required

## [0.5.0] - 2025-08-06

### Added

- Production ready status badge (#17)
- Comprehensive system overview page
- Enhanced project visibility and deployment status communication

### Changed

- Optimized codebase by removing dead code (#16)
- Removed obsolete workers.dev domain support
- Eliminated unused redirect logic and functions
- Reduced bundle size by ~0.5KB

### Fixed

- Applied consistent code formatting
- Resolved unused imports and TypeScript diagnostics

## [0.4.0] - 2025-08-05

### Changed

- Moved OKTA_DOMAIN from secrets to environment variables (#12)
- Updated wrangler from 4.27.0 to 4.28.0
- Enhanced configuration transparency

### Fixed

- Removed CLAUDE.md from git tracking (#15)
- Added CLAUDE.md to .gitignore (#14)

## [0.3.0] - 2025-08-05

### Fixed

- Removed invalid rate limiting rules configuration (#11)
- Fixed wrangler deployment errors
- Corrected configuration format for Workers environment

### Security

- Added comprehensive Semgrep security scanning workflow
- Configured multiple security rulesets (OWASP Top 10, secrets detection, JavaScript-specific rules)
- Enabled SARIF upload to GitHub Security tab
- Added automated PR comments with scan results
- Created custom Cloudflare Workers-specific security rules
- Scheduled weekly automated security scans

## [0.2.0] - 2025-08-05

### Added

- Enhanced Okta synchronization with group-based user fetching (#10)
- Flexible sync options (all users, group-specific, or profile-filtered)
- Comprehensive error handling and user feedback
- Detailed sync statistics in admin interface

### Changed

- Improved Okta integration architecture
- Enhanced admin dashboard with sync options

## [0.1.0] - 2025-08-05

### Added

- Initial production-ready release
- JWT-based authentication with cryptographic verification
- D1 database for training completion tracking
- Okta integration for user synchronization
- Responsive admin dashboard protected by Cloudflare Access
- Real-time training status management
- Complete audit trail of access decisions
- Modular codebase optimized for performance
- RSA key management with automatic generation
- Professional admin interface with SSO integration
- Comprehensive documentation
- Custom domain-only access (workers.dev disabled)
- Enterprise-ready architecture

### Security

- Cryptographic JWT verification
- RSA key management
- Cloudflare Access integration
- Complete audit trail
- Production-ready security posture
