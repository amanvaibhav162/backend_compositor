import fs from 'fs';
import path from 'path';

/**
 * @fileoverview Virtual File System (VFS) + Emitter
 * Collects all generated files in memory, then atomically writes to disk.
 * If any step fails, nothing is written — the user's filesystem is never corrupted.
 */

/** @type {Map<string, string>} filepath → content */
const vfs = new Map();

/**
 * Add a file to the in-memory VFS.
 * @param {string} filePath - Relative path (e.g. "src/index.js")
 * @param {string} content - File content
 */
export function addFile(filePath, content) {
  vfs.set(filePath, content);
}

/**
 * Flush all VFS files to disk atomically.
 * Only called after the ENTIRE pipeline succeeds.
 * @param {string} outputDir - The root output directory
 */
export function flushToDisk(outputDir) {
  for (const [relativePath, content] of vfs) {
    const fullPath = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

/**
 * Get the current VFS contents (useful for dry-run / preview).
 * @returns {Map<string, string>}
 */
export function getVFS() {
  return vfs;
}

/**
 * Reset the VFS (useful for testing).
 */
export function resetVFS() {
  vfs.clear();
}
