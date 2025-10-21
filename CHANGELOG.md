# Changelog

All notable changes to the Cloudflare Access Training Evaluator project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
