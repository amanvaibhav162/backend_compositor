import semver from 'semver';

export interface PackageCatalogEntry {
  name: string;
  defaultRange: string;
  minSupportedVersion: string;
  description: string;
  isDev?: boolean;
}

/**
 * Centralized Package Catalog for BackForge.
 * Defines audited, tested semver baseline ranges and minimum supported versions
 * to protect generated code from breaking upstream API shifts.
 */
export const PACKAGE_CATALOG: Record<string, PackageCatalogEntry> = {
  // Core Express Runtime
  'express': {
    name: 'express',
    defaultRange: '^4.21.2',
    minSupportedVersion: '4.18.0',
    description: 'Fast, unopinionated web framework for Node.js',
  },
  'dotenv': {
    name: 'dotenv',
    defaultRange: '^16.5.0',
    minSupportedVersion: '16.0.0',
    description: 'Loads environment variables from .env file',
  },
  'cors': {
    name: 'cors',
    defaultRange: '^2.8.5',
    minSupportedVersion: '2.8.0',
    description: 'CORS middleware for Express',
  },
  'cookie-parser': {
    name: 'cookie-parser',
    defaultRange: '^1.4.7',
    minSupportedVersion: '1.4.0',
    description: 'Parse Cookie header and populate req.cookies',
  },
  'helmet': {
    name: 'helmet',
    defaultRange: '^8.0.0',
    minSupportedVersion: '7.0.0',
    description: 'Security HTTP response headers',
  },
  'express-rate-limit': {
    name: 'express-rate-limit',
    defaultRange: '^7.5.0',
    minSupportedVersion: '7.0.0',
    description: 'Basic rate-limiting middleware for Express',
  },
  '@types/express': {
    name: '@types/express',
    defaultRange: '^4.17.21',
    minSupportedVersion: '4.17.0',
    description: 'TypeScript declarations for Express',
    isDev: true,
  },
  '@types/cors': {
    name: '@types/cors',
    defaultRange: '^2.8.17',
    minSupportedVersion: '2.8.0',
    description: 'TypeScript declarations for CORS',
    isDev: true,
  },
  '@types/cookie-parser': {
    name: '@types/cookie-parser',
    defaultRange: '^1.4.7',
    minSupportedVersion: '1.4.0',
    description: 'TypeScript declarations for cookie-parser',
    isDev: true,
  },

  // PostgreSQL + Drizzle ORM
  'drizzle-orm': {
    name: 'drizzle-orm',
    defaultRange: '^0.39.3',
    minSupportedVersion: '0.36.0',
    description: 'TypeScript ORM for PostgreSQL with native SQL feel',
  },
  'pg': {
    name: 'pg',
    defaultRange: '^8.13.3',
    minSupportedVersion: '8.10.0',
    description: 'PostgreSQL client for Node.js (connection pooling)',
  },
  'drizzle-kit': {
    name: 'drizzle-kit',
    defaultRange: '^0.30.4',
    minSupportedVersion: '0.28.0',
    description: 'Migration and studio CLI for Drizzle ORM',
    isDev: true,
  },
  '@types/pg': {
    name: '@types/pg',
    defaultRange: '^8.11.11',
    minSupportedVersion: '8.11.0',
    description: 'TypeScript declarations for pg',
    isDev: true,
  },

  // MongoDB + Mongoose
  'mongoose': {
    name: 'mongoose',
    defaultRange: '^8.13.2',
    minSupportedVersion: '8.0.0',
    description: 'MongoDB object modeling tool for Node.js',
  },

  // Authentication: JWT & Password Hashing
  'jsonwebtoken': {
    name: 'jsonwebtoken',
    defaultRange: '^9.0.2',
    minSupportedVersion: '9.0.0',
    description: 'JSON Web Token sign and verify implementation',
  },
  'bcryptjs': {
    name: 'bcryptjs',
    defaultRange: '^3.0.2',
    minSupportedVersion: '2.4.0',
    description: 'Optimized bcrypt in plain JavaScript',
  },
  '@types/jsonwebtoken': {
    name: '@types/jsonwebtoken',
    defaultRange: '^9.0.8',
    minSupportedVersion: '9.0.0',
    description: 'TypeScript declarations for jsonwebtoken',
    isDev: true,
  },
  '@types/bcryptjs': {
    name: '@types/bcryptjs',
    defaultRange: '^2.4.6',
    minSupportedVersion: '2.4.0',
    description: 'TypeScript declarations for bcryptjs',
    isDev: true,
  },

  // Authentication: Google OAuth (Passport.js)
  'passport': {
    name: 'passport',
    defaultRange: '^0.7.0',
    minSupportedVersion: '0.6.0',
    description: 'Simple, unobtrusive authentication for Node.js',
  },
  'passport-google-oauth20': {
    name: 'passport-google-oauth20',
    defaultRange: '^2.0.0',
    minSupportedVersion: '2.0.0',
    description: 'Google OAuth 2.0 strategy for Passport',
  },
  '@types/passport': {
    name: '@types/passport',
    defaultRange: '^1.0.17',
    minSupportedVersion: '1.0.0',
    description: 'TypeScript declarations for Passport',
    isDev: true,
  },
  '@types/passport-google-oauth20': {
    name: '@types/passport-google-oauth20',
    defaultRange: '^2.0.16',
    minSupportedVersion: '2.0.0',
    description: 'TypeScript declarations for passport-google-oauth20',
    isDev: true,
  },
};

/**
 * Returns the default verified semver range for a given package name.
 */
export function getPackageRange(pkgName: string): string {
  const entry = PACKAGE_CATALOG[pkgName];
  if (!entry) {
    throw new Error(`Package "${pkgName}" is not registered in the BackForge package catalog.`);
  }
  return entry.defaultRange;
}

/**
 * Validates a user-supplied version override against semver rules and minimum API compatibility.
 */
export function validateVersionOverride(
  pkgName: string,
  userRange: string
): { valid: boolean; error?: string } {
  if (!semver.validRange(userRange)) {
    return {
      valid: false,
      error: `Invalid semver range "${userRange}" specified for package "${pkgName}".`,
    };
  }

  const entry = PACKAGE_CATALOG[pkgName];
  if (entry) {
    const minRequired = entry.minSupportedVersion;
    // Check if the user's range can satisfy at least the minimum supported version
    const maxUserVer = semver.maxSatisfying([minRequired, '999.999.999'], userRange);
    const minUserVer = semver.minVersion(userRange);

    if (minUserVer && semver.lt(minUserVer, minRequired) && (!maxUserVer || semver.lt(maxUserVer, minRequired))) {
      return {
        valid: false,
        error: `Incompatible version override: Package "${pkgName}" requires >=${minRequired} for code generation, but "${userRange}" does not satisfy it.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Utility to construct a dependencies record from catalog names.
 */
export function buildDependencies(names: string[]): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const name of names) {
    deps[name] = getPackageRange(name);
  }
  return deps;
}
