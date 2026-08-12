import { addFile } from '../../engine/emitter.js';
import type { Hook, ModuleBootstrapConfig } from '../../engine/types.js';

export const id = 'auth:jwt';
export const provides: string[] = ['auth:jwt'];
export const requires: string[] = ['db:mongodb'];
export const dependencies: Record<string, string> = {
  'jsonwebtoken': '^9.0.2',
  'bcryptjs': '^3.0.2',
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

    addFile('src/models/user.model.js', `import mongoose, { Schema } from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const userSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
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

userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.isPasswordCorrect = async function (password) {
    return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            role: this.role,
        },
        process.env.ACCESS_TOKEN_SECRET,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
        }
    );
};

userSchema.methods.generateRefreshToken = function () {
    return jwt.sign(
        {
            _id: this._id,
        },
        process.env.REFRESH_TOKEN_SECRET,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
        }
    );
};

export const User = mongoose.model("User", userSchema);
`);

    addFile('src/controllers/user.controller.js', `import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const registerUser = asyncHandler(async (req, res) => {
    const { email, password, role } = req.body;

    if ([email, password].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    const existedUser = await User.findOne({ email });
    if (existedUser) {
        throw new ApiError(409, "User with email already exists");
    }

    const user = await User.create({ 
        email, 
        password,
        role: role || 'user'
    });

    const createdUser = await User.findById(user._id).select("-password -refreshToken");

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user");
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully")
    );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email });

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

    const options = {
        httpOnly: true,
        secure: true
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser, accessToken, refreshToken
                },
                "User logged In Successfully"
            )
        );
});

    const logoutUser = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    await User.findByIdAndUpdate(userId, {
        $unset: { refreshToken: "" }
    });

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
    };

    return res
        .status(200)
        .clearCookie("accessToken", cookieOptions)
        .clearCookie("refreshToken", cookieOptions)
        .json(
            new ApiResponse(200, "User logged out successfully", null)
        );
    });

export { registerUser, loginUser, logoutUser };
`);

    addFile('src/middlewares/auth.middleware.js', `import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

export const verifyJWT = asyncHandler(async(req, _, next) => {
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");
        
        if (!token) {
            throw new ApiError(401, "Unauthorized request");
        }
    
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");
    
        if (!user) {
            throw new ApiError(401, "Invalid Access Token");
        }
    
        req.user = user;
        next();
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid access token");
    }
});
`);

    if (useRBAC) {
        addFile('src/middlewares/role.middleware.js', `import { ApiError } from "../utils/ApiError.js";

export const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            throw new ApiError(401, "Authentication required");
        }

        if (!roles.includes(req.user.role)) {
            throw new ApiError(403, "Access denied: Insufficient permissions");
        }

        next();
    };
};
`);
    }

    const rbacImport = useRBAC ? `import { checkRole } from "../middlewares/role.middleware.js";\n` : '';
    const adminRoute = useRBAC ? `router.route("/admin-only").get(verifyJWT, checkRole(['admin']), (req, res) => res.send("Admin only content"));\n` : '';

    addFile('src/routes/user.routes.js', `import { Router } from "express";
import { loginUser, registerUser, logoutUser } from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
${rbacImport}
const router = Router();

router.route("/register").post(registerUser);
router.route("/login").post(loginUser);

router.route("/logout").post(verifyJWT, logoutUser);
${adminRoute}
export default router;
`);
}
