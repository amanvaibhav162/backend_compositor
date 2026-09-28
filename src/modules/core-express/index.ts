import { addFile } from '../../engine/emitter.js';
import type { Slot, HookResult, ModuleBootstrapConfig, SlotResolver } from '../../engine/types.js';

export const id = 'core:express';
export const provides: string[] = ['core:express'];
export const requires: string[] = [];

export const dependencies: Record<string, string> = {
  'express': '^4.21.2',
  'dotenv': '^16.5.0',
  'cors': '^2.8.5',
  'cookie-parser': '^1.4.7',
  'helmet': '^8.0.0',
  'express-rate-limit': '^7.5.0',
};

export const devDependencies: Record<string, string> = {
  '@types/express': '^4.17.21',
  '@types/cors': '^2.8.17',
  '@types/cookie-parser': '^1.4.7',
};

export const envVars = `PORT=8000
CORS_ORIGIN=*`;

export const slots: Record<string, Slot> = {
  'express:app:imports': {
    name: 'express:app:imports',
    description: 'Inject imports into app.ts',
  },
  'express:app:middleware': {
    name: 'express:app:middleware',
    description: 'Inject middleware into app.ts',
  },
  'express:app:routes': {
    name: 'express:app:routes',
    description: 'Inject route definitions into app.ts',
  },
  'express:index:imports': {
    name: 'express:index:imports',
    description: 'Inject imports into index.ts (e.g. DB connection)',
  },
  'express:index:start': {
    name: 'express:index:start',
    description: 'Inject logic before server start in index.ts',
  },
  'express:app:error': {
    name: 'express:app:error',
    description: 'Inject error handling middleware into app.ts',
  },
};

export async function bootstrap(config: ModuleBootstrapConfig, resolveSlot?: SlotResolver): Promise<void> {
  if (!resolveSlot) throw new Error('core:express requires a resolveSlot function');

  const appImports = await resolveSlot('express:app:imports', config);
  const appMiddleware = await resolveSlot('express:app:middleware', config);
  const appRoutes = await resolveSlot('express:app:routes', config);
  const appErrors = await resolveSlot('express:app:error', config);

  const indexImports = await resolveSlot('express:index:imports', config);
  const indexStart = await resolveSlot('express:index:start', config);

  // 1. Constants
  addFile('src/constants.ts', `export const DB_NAME: string = "${config.project?.name || 'backforge_db'}";\n`);

  // 2. Async Handler
  addFile('src/utils/asyncHandler.ts', `import { Request, Response, NextFunction, RequestHandler } from 'express';

export const asyncHandler = (
  requestHandler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
  };
};
`);

  // 3. ApiError
  addFile('src/utils/ApiError.ts', `export class ApiError extends Error {
  public statusCode: number;
  public data: unknown;
  public success: boolean;
  public errors: unknown[];

  constructor(
    statusCode: number,
    message = "Something went wrong",
    errors: unknown[] = [],
    stack = ""
  ) {
    super(message);
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
`);

  // 4. ApiResponse
  addFile('src/utils/ApiResponse.ts', `export class ApiResponse<T = unknown> {
  public statusCode: number;
  public data: T;
  public message: string;
  public success: boolean;

  constructor(statusCode: number, data: T, message = "Success") {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
  }
}
`);

  // 5. Error Handler Middleware
  addFile('src/middlewares/error.middleware.ts', `import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ApiError } from '../utils/ApiError.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error?.statusCode || (typeof error?.status === 'number' ? error.status : 500);
    const message = error?.message || "Something went wrong";
    error = new ApiError(statusCode, message, error?.errors || [], err?.stack);
  }

  const response = {
    statusCode: error.statusCode,
    message: error.message,
    success: false,
    errors: error.errors,
    ...(process.env.NODE_ENV === "development" ? { stack: error.stack } : {})
  };

  res.status(error.statusCode).json(response);
};
`);

  const appImportsContent = appImports.flatMap((f: HookResult) => f.imports || []).join('\n');
  const appMiddlewareContent = appMiddleware.map((f: HookResult) => f.content).join('\n');
  const appRoutesContent = appRoutes.map((f: HookResult) => f.content).join('\n');
  const appErrorsContent = appErrors.map((f: HookResult) => f.content).join('\n');

  // 6. Express App
  addFile('src/app.ts', `import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middlewares/error.middleware.js';

${appImportsContent}

const app = express();

// Security Headers
app.use(helmet());

// Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: 'Too many requests from this IP, please try again after 15 minutes',
    success: false,
  },
});
app.use(globalLimiter);

// CORS Configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Body Parsers & Cookies
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

${appMiddlewareContent}

${appRoutesContent}

// Database-aware Health Check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'HEALTHY',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
  });
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    statusCode: 404,
    message: \`Cannot \${req.method} \${req.originalUrl} - Not Found\`,
    success: false,
    errors: [],
  });
});

${appErrorsContent}

// Global Error Handler
app.use(errorHandler);

export { app };
`);

  const indexImportsContent = indexImports.flatMap((f: HookResult) => f.imports || []).join('\n');
  const indexStartContent = indexStart.map((f: HookResult) => f.content).join('\n');

  // 7. Server Entry Point with Graceful Shutdown
  addFile('src/index.ts', `import 'dotenv/config';
import http from 'http';
import { app } from './app.js';
${indexImportsContent}

const startServer = async (): Promise<void> => {
  try {
    ${indexStartContent}
    const PORT = Number(process.env.PORT) || 8000;
    const server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(\`🚀 Server running at http://localhost:\${PORT}\`);
      console.log(\`🩺 Health check live at http://localhost:\${PORT}/health\`);
    });

    // Graceful Shutdown Handlers (SIGTERM & SIGINT)
    const gracefulShutdown = (signal: string) => {
      console.log(\`\\n🛑 Received \${signal}. Draining active connections...\`);
      server.close(() => {
        console.log('✅ HTTP server closed gracefully.');
        process.exit(0);
      });

      // Force shutdown after timeout
      setTimeout(() => {
        console.error('⚠️ Could not close connections in time, forcefully shutting down.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    console.error("❌ Server startup failed: ", err);
    process.exit(1);
  }
};

startServer();
`);

  addFile('public/temp/.gitkeep', '');
  addFile('.gitignore', `node_modules\ndist\n.env\npublic/temp/*\n`);
}
