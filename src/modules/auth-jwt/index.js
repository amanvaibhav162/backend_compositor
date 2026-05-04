import { registerHook } from '../../engine/hookSystem.js';
import { addFile } from '../../engine/emitter.js';

/**
 * Module: auth:jwt
 * Provides JWT-based authentication.
 * Requires: db:mongodb (needs User model)
 * Hooks into: express:middleware, express:routes, express:imports
 */
export const id = 'auth:jwt';
export const provides = ['auth:jwt'];
export const requires = ['db:mongodb'];

export const hooks = [
  // Hook 1: Inject the auth router import into express
  {
    name: 'auth:jwt:import-hook',
    targetSlot: 'express:imports',
    priority: 20,
    async execute(_config) {
      return {
        content: '',
        imports: [`import authRouter from './auth/router.js';`],
      };
    },
  },
  // Hook 2: Mount the auth middleware
  {
    name: 'auth:jwt:middleware-hook',
    targetSlot: 'express:middleware',
    priority: 10,
    async execute(_config) {
      return {
        content: `import { verifyToken } from './auth/middleware.js';\n// Auth middleware is applied per-route via verifyToken`,
        imports: [],
      };
    },
  },
  // Hook 3: Mount auth routes
  {
    name: 'auth:jwt:routes-hook',
    targetSlot: 'express:routes',
    priority: 10,
    async execute(_config) {
      return {
        content: `app.use('/auth', authRouter);`,
        imports: [],
      };
    },
  },
];

/**
 * Bootstrap this module: register hooks and generate all auth files.
 * @param {Record<string, any>} config
 */
export async function bootstrap(config) {
  for (const hook of hooks) {
    registerHook(hook);
  }

  // ── User Model ──────────────────────────────────────────────────────────────
  addFile('src/auth/model.js', `import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 8 },
  role:     { type: String, enum: ['user', 'admin'], default: 'user' },
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password to hash
userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.model('User', userSchema);
`);

  // ── JWT Service ─────────────────────────────────────────────────────────────
  addFile('src/auth/service.js', `import jwt from 'jsonwebtoken';
import { User } from './model.js';

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!SECRET) throw new Error('Missing env variable: JWT_SECRET');

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyTokenPayload(token) {
  return jwt.verify(token, SECRET);
}

export async function registerUser({ email, password }) {
  const existing = await User.findOne({ email });
  if (existing) throw new Error('Email already registered');
  const user = await User.create({ email, password });
  return { id: user._id, email: user.email, role: user.role };
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email });
  if (!user) throw new Error('Invalid email or password');
  const valid = await user.comparePassword(password);
  if (!valid) throw new Error('Invalid email or password');
  const token = signToken({ id: user._id, role: user.role });
  return { token };
}
`);

  // ── Middleware ──────────────────────────────────────────────────────────────
  addFile('src/auth/middleware.js', `import { verifyTokenPayload } from './service.js';

export function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    req.user = verifyTokenPayload(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Token is invalid or expired' });
  }
}
`);

  // ── Router ──────────────────────────────────────────────────────────────────
  addFile('src/auth/router.js', `import { Router } from 'express';
import { registerUser, loginUser } from './service.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const user = await registerUser(req.body);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const result = await loginUser(req.body);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

export default router;
`);
}
