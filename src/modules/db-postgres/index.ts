import { addFile } from '../../engine/emitter.js';
import type { Hook, ModuleBootstrapConfig } from '../../engine/types.js';
import { buildDependencies } from '../../engine/catalog.js';

export const id = 'db:postgres';
export const provides: string[] = ['db:postgres', 'core:database'];
export const requires: string[] = ['core:express'];

export const dependencies: Record<string, string> = buildDependencies([
  'drizzle-orm',
  'pg',
  'dotenv',
]);

export const devDependencies: Record<string, string> = buildDependencies([
  'drizzle-kit',
  '@types/pg',
]);

export const envVars = `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mydb`;

export const hooks: Hook[] = [
  {
    name: 'db:postgres:index-import',
    targetSlot: 'express:index:imports',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: '',
        imports: [`import connectDB from './db/db.js';`],
      };
    },
  },
  {
    name: 'db:postgres:index-start',
    targetSlot: 'express:index:start',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: `await connectDB();`,
      };
    },
  },
];

export async function bootstrap(_config: ModuleBootstrapConfig): Promise<void> {
  // 1. Connection Pool & Drizzle Client
  const connectionContent = `import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mydb';

export const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });

const connectDB = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected successfully (Drizzle ORM)');
    client.release();
  } catch (error) {
    console.error('❌ PostgreSQL connection FAILED: ', error);
    process.exit(1);
  }
};

export default connectDB;
`;
  addFile('src/db/db.ts', connectionContent);

  // 2. Drizzle Schema
  const schemaContent = `import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 255 }),
  password: text('password'),
  googleId: varchar('google_id', { length: 255 }).unique(),
  role: varchar('role', { length: 50 }).notNull().default('user'),
  refreshToken: text('refresh_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
`;
  addFile('src/db/schema.ts', schemaContent);

  // 3. Drizzle Kit Configuration
  const drizzleConfigContent = `import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mydb',
  },
});
`;
  addFile('drizzle.config.ts', drizzleConfigContent);
}
