import { addFile } from '../../engine/emitter.js';
import type { Hook, ModuleBootstrapConfig } from '../../engine/types.js';

export const id = 'auth:jwt';
export const provides: string[] = ['auth:jwt'];
export const requires: string[] = ['core:express', 'db:mongodb'];

export const dependencies: Record<string, string> = {
  'jsonwebtoken': '^9.0.2',
  'bcryptjs': '^3.0.2',
};

export const devDependencies: Record<string, string> = {
  '@types/jsonwebtoken': '^9.0.8',
  '@types/bcryptjs': '^2.4.6',
};

export const envVars = `ACCESS_TOKEN_SECRET=replace_this_with_a_long_random_string
ACCESS_TOKEN_EXPIRY=1d
REFRESH_TOKEN_SECRET=replace_this_with_another_long_random_string
REFRESH_TOKEN_EXPIRY=10d`;

export const hooks: Hook[] = [
  {
    name: 'auth:jwt:app-import',
    targetSlot: 'express:app:imports',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: '',
        imports: [`import userRouter from './routes/user.routes.js';`],
      };
    },
  },
  {
    name: 'auth:jwt:app-routes',
    targetSlot: 'express:app:routes',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: `app.use('/api/v1/users', userRouter);`,
      };
    },
  },
];

export async function bootstrap(config: ModuleBootstrapConfig): Promise<void> {
  const options = config.options || {};
  const useRBAC = options.rbac === true;

  // 1. Ambient Express Request Type Declaration
  addFile('src/types/express.d.ts', `import { IUser } from '../models/user.model.js';

declare global {
  namespace Express {
    interface User extends IUser {}
    interface Request {
      user?: IUser;
    }
  }
}

export {};
`);

  // 2. User Mongoose Model
  addFile('src/models/user.model.ts', `import mongoose, { Schema, Document, Model } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  username?: string;
  password?: string;
  googleId?: string;
  role: 'user' | 'admin';
  refreshToken?: string;
  createdAt: Date;
  updatedAt: Date;
  isPasswordCorrect(password: string): Promise<boolean>;
  generateAccessToken(): string;
  generateRefreshToken(): string;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: function (this: IUser) {
        return !this.googleId;
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    refreshToken: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {
  if (!this.password) return false;
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function (): string {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error('ACCESS_TOKEN_SECRET environment variable is not defined');

  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      role: this.role,
    },
    secret,
    {
      expiresIn: (process.env.ACCESS_TOKEN_EXPIRY || '1d') as any,
    }
  );
};

userSchema.methods.generateRefreshToken = function (): string {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  if (!secret) throw new Error('REFRESH_TOKEN_SECRET environment variable is not defined');

  return jwt.sign(
    {
      _id: this._id,
    },
    secret,
    {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRY || '10d') as any,
    }
  );
};

export const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
`);

  // 3. User Controller
  addFile('src/controllers/user.controller.ts', `import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/user.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';

export const registerUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, role } = req.body;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, "Email and password are required");
  }

  const existedUser = await User.findOne({ email: email.toLowerCase() });
  if (existedUser) {
    throw new ApiError(409, "User with email already exists");
  }

  const user = await User.create({
    email: email.toLowerCase(),
    password,
    role: role === 'admin' ? 'admin' : 'user',
  });

  const createdUser = await User.findById(user._id).select("-password -refreshToken");
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user");
  }

  res.status(201).json(
    new ApiResponse(201, createdUser, "User registered successfully")
  );
});

export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "User logged in successfully"
      )
    );
});

export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?._id;

  if (userId) {
    await User.findByIdAndUpdate(userId, {
      $unset: { refreshToken: "" }
    });
  }

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, null, "User logged out successfully"));
});
`);

  // 4. Auth Middleware
  addFile('src/middlewares/auth.middleware.ts', `import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/user.model.js';

interface JwtPayload {
  _id: string;
  email: string;
  role: 'user' | 'admin';
}

export const verifyJWT = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new ApiError(401, 'Unauthorized request: Missing token');
    }

    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
      throw new ApiError(500, 'Server configuration error: ACCESS_TOKEN_SECRET missing');
    }

    const decodedToken = jwt.verify(token, secret) as JwtPayload;
    const user = await User.findById(decodedToken?._id).select('-password -refreshToken');

    if (!user) {
      throw new ApiError(401, 'Invalid Access Token: User not found');
    }

    req.user = user;
    next();
  } catch (error: any) {
    throw new ApiError(401, error?.message || 'Invalid access token');
  }
});
`);

  // 5. Role Middleware (if RBAC enabled)
  if (useRBAC) {
    addFile('src/middlewares/role.middleware.ts', `import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';

export const checkRole = (roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, 'Access denied: Insufficient permissions');
    }

    next();
  };
};
`);
  }

  const rbacImport = useRBAC ? `import { checkRole } from '../middlewares/role.middleware.js';\n` : '';
  const adminRoute = useRBAC ? `router.route('/admin-only').get(verifyJWT, checkRole(['admin']), (_req, res) => res.json({ message: 'Admin-only content authorized' }));\n` : '';

  // 6. User Routes
  addFile('src/routes/user.routes.ts', `import { Router } from 'express';
import { loginUser, registerUser, logoutUser } from '../controllers/user.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
${rbacImport}
const router = Router();

router.route('/register').post(registerUser);
router.route('/login').post(loginUser);
router.route('/logout').post(verifyJWT, logoutUser);
${adminRoute}
export default router;
`);
}
