# Project guidance

## Purpose and boundaries

This Cloudflare Worker evaluates Cloudflare Access requests against training completion, synchronizes Okta users into D1, and provides an Access-protected administration dashboard. Treat authorization and identity synchronization as security-sensitive operations.

- Only `completed` grants access. `started` and `not started` deny access.
- Admin authentication (`src/auth/access.ts`) verifies the RS256 signature of the Access JWT (`cf-access-jwt-assertion`, or `cf-access-jwt`) against the team keys via `verifyToken`, requires a numeric unexpired `exp`, pins `iss` to `https://TEAM_DOMAIN`, and matches `aud` to `ACCESS_APP_AUD`. Unsigned headers such as `CF-Access-Jwt-Payload` are never trusted. Never weaken these checks or bypass authentication for local previews.
- State-changing admin requests (non-GET/HEAD/OPTIONS) must pass the server-side origin check in `src/auth/origin.ts`, which runs after authentication: `Origin` must be the request origin or `https://ADMIN_DOMAIN`, else `Sec-Fetch-Site` must be `same-origin`; requests with neither header are non-browser clients and are allowed.
- The CSP is always strict (no `unsafe-inline`/`unsafe-eval`). `DEBUG` never relaxes it, and is parsed only by `isDebugEnabled` in `src/utils/env.ts` (the string `"false"` is not debug). Only an exact `ENVIRONMENT=development` drops `upgrade-insecure-requests`/`block-all-mixed-content` for local http.
- Routing in `src/index.ts` is exact-match: unknown paths get 404 and wrong methods get 405 with `Allow`. Nothing falls through to the evaluation handler except `POST /`. `GET /keys` and `POST /` are called by the Access external-evaluation rule from the demo Terraform; never change those contracts.
- Tests marked `knownGap` stay green while a gap exists and fail when it is fixed; promote them to `it` then.
- Preserve routes and API contracts in `src/index.ts`. Dashboard aliases `/admin` and `/dashboard` remain authenticated.
- Do not change training status during Okta profile synchronization. `syncUsersToDatabase` requires an explicit `full` or `group` scope. Only a full-directory snapshot can reconcile deletions; group sync is add/update-only, including empty groups. Never pass a partial paginated directory to the deletion step.
- Never log private signing key material, even in DEBUG or initial setup. Provision matching keys using the local-only `scripts/generate-signing-keys.mjs`; never change existing live keys without explicit rotation approval.
- Access applications are provisioned and torn down by separate demo Terraform. An absent app is expected between demos; do not create or modify Access apps here to work around missing JWT headers.
- Reject failed/unexpected Okta pages and unsafe pagination URLs; never send credentials to another origin.
- Never deploy, commit, push, initialize a live database, or run a live sync unless explicitly requested.

## Structure

- `src/index.ts`: Worker routing and administration authentication.
- `src/auth/`: Access/JWT verification, evaluation and key handling.
- `src/database/training.ts`: D1 queries and synchronization.
- `src/integrations/okta.ts`: Okta pagination and profile retrieval.
- `src/handlers/web.ts`: protected dashboard HTML, training update API, and public system overview.
- `src/security/csp.ts`: security headers and nonce helpers.
- `ui/`: React dashboard using actual `@cloudflare/kumo` components.
- `scripts/build-ui.mjs`: Vite build embedding browser JS/CSS in generated TypeScript.
- `tests/`: unit and regression tests; no live credentials or external services.

## UI changes

Read installed `node_modules/@cloudflare/kumo/ai/USAGE.md` and component registry for version-correct APIs. Use granular component imports, semantic tokens, and `data-mode` for light/dark themes. Do not invent live data, sync history, roles, or settings that the API does not provide.

Keep initial records behind the authenticated HTML handler. Serialize bootstrap JSON safely: user-controlled names/emails must never close a script element. Never expose secrets in browser state. Preserve the strict CSP without `unsafe-inline`, `unsafe-eval`, or relaxed debugging settings. Exercise menus, dialogs and notifications under CSP, not only the initial page.

Only show confirmed successful mutations. Revert failed edits; distinguish partial bulk success, retain failed selections, and explain that training changes affect access. Use real sync results rather than simulated timing or counters.

## Commands

- `npm ci`: install the locked dependencies.
- `npm run build`: generate UI assets and type-check the Worker, dashboard and tests.
- `npm test`: build assets and run unit/regression tests.
- `npm run test:coverage`: run coverage reporting.
- `npm run lint` / `npm run lint:fix`: ESLint flat config (`eslint.config.mjs`), type-aware, covering `src/`, `ui/` and `tests/`. Keep it at zero findings.
- `npm run types` / `npm run types:check`: regenerate or verify `worker-configuration.d.ts` (the `Env` type). Secret names live in `.dev.vars.example` (names only, never values). Run `npm run types` after changing bindings, vars or secrets in `wrangler.jsonc`.
- `npm run dev`: generate assets and start Wrangler locally.
- `npm run deploy`: deployment; requires explicit authorization.
- `npm audit`: keep at zero vulnerabilities.

`Env` is `Cloudflare.Env` (generated) plus two optional settings in `src/types/index.ts`. Do not hand-write bindings there. Commit `worker-configuration.d.ts`: `tsc` needs it.

Generated `src/ui-assets.generated.ts` and `.ui-build/` are ignored. Do not edit or commit them. The Wrangler custom build runs asset generation for direct Wrangler commands and Workers Builds too.

## Change discipline

Inspect all tracked/untracked changes before editing or staging. Keep unrelated user work intact. Add regression tests before changing sensitive logic, run the full test suite and both type checks, and review the diff. Prefer targeted cleanup; report uncertain dead-code candidates and behavioral enhancements rather than deleting them speculatively. Document remaining risks and validation gaps honestly.
