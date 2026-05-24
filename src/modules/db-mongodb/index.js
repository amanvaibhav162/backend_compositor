import { addFile } from '../../engine/emitter.js';

/**
 * Module: db:mongodb
 * Professional DB integration.
 */
export const id = 'db:mongodb';
export const provides = ['db:mongodb'];
export const requires = [];
export const dependencies = {
  'mongoose': '^8.13.2',
};
export const envVars = `MONGODB_URI=mongodb://localhost:27017`;

export const hooks = [
  {
    name: 'db:mongodb:index-import',
    targetSlot: 'express:index:imports',
    priority: 10,
    async execute(_config) {
      return {
        content: '',
        imports: [`import connectDB from './db/db.js';`],
      };
    },
  },
  {
    name: 'db:mongodb:index-start',
    targetSlot: 'express:index:start',
    priority: 10,
    async execute(_config) {
      return {
        content: `await connectDB();`,
      };
    },
  },
];

export async function bootstrap(config) {
  // Hooks are registered by the pipeline

  const connectionContent = `import mongoose from 'mongoose';
import { DB_NAME } from '../constants.js';

const connectDB = async () => {
    try {
        const connectionInstance = await mongoose.connect(\`\${process.env.MONGODB_URI}/\${DB_NAME}\`);
        console.log(\`✅ MongoDB connected !! DB HOST: \${connectionInstance.connection.host}\`);
    } catch (error) {
        console.log("❌ MONGODB connection FAILED ", error);
        process.exit(1);
    }
};

export default connectDB;
`;
  addFile('src/db/db.js', connectionContent);
}
