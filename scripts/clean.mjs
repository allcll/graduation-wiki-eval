import { rm } from 'node:fs/promises';

// Resolve from the script so the cleanup cannot target a caller's working directory.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
