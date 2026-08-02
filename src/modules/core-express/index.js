import { addFile } from '../../engine/emitter.js';

export const id = 'core:express';
export const provides = ['core:express'];
export const requires = [];
export const dependencies = {
  'express': '^4.21.2',
  'dotenv': '^16.5.0',
  'cors': '^2.8.5',
  'cookie-parser': '^1.4.7',
};
export const envVars = `PORT=8000
CORS_ORIGIN=*`;

export const slots = {
  'express:app:imports': {
    name: 'express:app:imports',
    description: 'Inject imports into app.js',
  },
  'express:app:middleware': {
    name: 'express:app:middleware',
    description: 'Inject middleware into app.js',
  },
  'express:app:routes': {
    name: 'express:app:routes',
    description: 'Inject route definitions into app.js',
  },
  'express:index:imports': {
    name: 'express:index:imports',
    description: 'Inject imports into index.js (e.g. DB connection)',
  },
  'express:index:start': {
    name: 'express:index:start',
    description: 'Inject logic before server start in index.js',
  },
};

export async function bootstrap(config, resolveSlot) {
  const appImports = await resolveSlot('express:app:imports', config);
  const appMiddleware = await resolveSlot('express:app:middleware', config);
  const appRoutes = await resolveSlot('express:app:routes', config);

  const indexImports = await resolveSlot('express:index:imports', config);
  const indexStart = await resolveSlot('express:index:start', config);

  addFile('src/constants.js', `export const DB_NAME = "${config.project?.name || 'backforge_db'}";\n`);

  addFile('src/utils/asyncHandler.js', `const asyncHandler = (requestHandler) => {
    return (req, res, next) => {
        Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
    };
};

export { asyncHandler };
`);

  addFile('src/utils/ApiError.js', `class ApiError extends Error {
    constructor(
        statusCode,
        message = "Something went wrong",
        errors = [],
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

export { ApiError };
`);

  addFile('src/utils/ApiResponse.js', `class ApiResponse {
    constructor(statusCode, data, message = "Success") {
        this.statusCode = statusCode;
        this.data = data;
        this.message = message;
        this.success = statusCode < 400;
    }
}

export { ApiResponse };
`);

  const appImportsContent = appImports.flatMap(f => f.imports || []).join('\n');
  const appMiddlewareContent = appMiddleware.map(f => f.content).join('\n');
  const appRoutesContent = appRoutes.map(f => f.content).join('\n');

  addFile('src/app.js', `import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

${appImportsContent}

const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

${appMiddlewareContent}

${appRoutesContent}

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

export { app };
`);

  const indexImportsContent = indexImports.flatMap(f => f.imports || []).join('\n');
  const indexStartContent = indexStart.map(f => f.content).join('\n');

  addFile('src/index.js', `import 'dotenv/config';
import { app } from './app.js';
${indexImportsContent}

const startServer = async () => {
    try {
        ${indexStartContent}
        const PORT = process.env.PORT || 8000;
        app.listen(PORT, () => {
            console.log(\`🚀 Server is running at port : \${PORT}\`);
        });
    } catch (err) {
        console.log("❌ Server start failed !!! ", err);
    }
};

startServer();
`);

  addFile('public/temp/.gitkeep', '');
  addFile('.gitignore', `node_modules\n.env\npublic/temp/*\n`);
}
