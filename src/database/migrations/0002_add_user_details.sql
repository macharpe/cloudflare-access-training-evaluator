-- Migration: Add first_name and primary_email columns to users table
-- This allows storing additional user information from Okta

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN primary_email TEXT;

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(primary_email);