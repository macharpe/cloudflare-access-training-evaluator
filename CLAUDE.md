# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker that implements an external evaluation rule for Cloudflare Access. It acts as a JWT-based authentication service that validates Access tokens and returns custom authorization decisions.

## Architecture

The worker follows this flow:
1. **Key Management**: Automatically generates RSA key pairs on first run, stores them in Workers KV
2. **Token Validation**: Receives JWT tokens from Cloudflare Access, validates them using Access public keys
3. **Business Logic**: Executes custom authorization logic in `externalEvaluation()` function
4. **Response Signing**: Returns signed JWT responses to Access with allow/deny decisions

Key files:
- `src/index.js`: Main worker entry point
- `src/handlers/index.js`: HTTP request handlers
- `src/auth/`: Authentication modules (JWT, keys, evaluation logic)
- `src/database/training.js`: D1 database operations for training certification
- `src/database/migrations/`: SQL migration files for D1 database setup
- `src/utils/encoding.js`: Base64 encoding utilities
- `wrangler.jsonc`: Cloudflare Workers configuration with KV and D1 bindings
- `.envrc`: Environment variables loaded by direnv (not committed to git)

## Development Commands

### Deploy
```bash
wrangler deploy
```

### Live Debugging
```bash
wrangler tail -f pretty
```

### Code Formatting
```bash
npm run format
```

## Configuration

This project uses direnv for environment-based configuration:
1. Copy `.envrc.example` to `.envrc`
2. Update `.envrc` with your actual infrastructure IDs
3. Run `direnv allow` to load environment variables
4. Set `DEBUG = true` in `.envrc` for JWT logging during development

## Core Components

### JWT Processing (`src/auth/jwt.js`)
- `parseJWT()`: Splits and decodes JWT tokens
- `verifyToken()`: Validates Access tokens using Cloudflare's public keys
- `signJWT()`: Creates signed response tokens

### Key Management (`src/auth/keys.js`)
- `generateKeys()`: Creates RSA-2048 key pairs, stores in KV
- `loadPublicKey()`: Retrieves public keys from KV storage
- Keys are automatically generated on first `/keys` endpoint call

### Training Database (`src/database/training.js`)
- `initializeDatabase()`: Sets up D1 database tables and initial user data
- `getUserTrainingStatus()`: Queries user training certification status
- `updateUserTrainingStatus()`: Updates user training progress

### Business Logic (`src/auth/evaluation.js`)
The `externalEvaluation()` function contains custom authorization logic that checks if users have completed required training certification before granting access.

## API Endpoints

- `GET /keys`: Returns public key in JWKS format for Access to verify worker responses
- `GET /init-db`: Initializes D1 database with users table and training data
- `POST /`: Main evaluation endpoint that receives Access tokens and returns authorization decisions

## Testing External Evaluation Rules

1. Deploy worker with `wrangler deploy`
2. Configure Access policy with External Evaluation rule pointing to your worker
3. Use `wrangler tail -f pretty` for real-time debugging
4. Enable `DEBUG=true` in `.envrc` to see JWT payloads (use jwt.io to decode)