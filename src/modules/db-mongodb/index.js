import { registerHook } from '../../engine/hookSystem.js';
import { addFile } from '../../engine/emitter.js';

/**
 * Module: db:mongodb
 * Provides a Mongoose connection.
 * Hooks into express:imports to wire DB before the server starts.
 */
export const id = 'db:mongodb';
export const provides = ['db:mongodb'];
export const requires = [];

export const hooks = [
  {
    name: 'db:mongodb:import-hook',
    targetSlot: 'express:imports',
    priority: 10,
    async execute(config) {
      return {
        content: '',
        imports: [`import { connectDB } from './db/connection.js';`, `await connectDB();`],
      };
    },
  },
];

/**
 * Bootstrap this module: register hooks and produce files.
 * @param {Record<string, any>} config
 */
export async function bootstrap(config) {
  // Register hooks
  for (const hook of hooks) {
    registerHook(hook);
  }

  // Generate the DB connection file
  const connectionContent = `import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/${config.project?.name ?? 'mydb'}';

export async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}
`;
  addFile('src/db/connection.js', connectionContent);
}
