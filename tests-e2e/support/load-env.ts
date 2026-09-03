/**
 * Loads .env, and must be imported before anything reads process.env.
 *
 * This lives in its own module on purpose. ES module imports are hoisted and
 * evaluated in source order, so calling dotenv.config() inside a config file
 * that also imports env.ts would run *after* env.ts had already read
 * process.env. Importing this from the top of env.ts makes the ordering
 * correct for every consumer, whatever imports them.
 */

import dotenv from 'dotenv';

// override: false so a real environment variable (a CI secret) always beats a
// stale local .env.
dotenv.config({ override: false, quiet: true });
