import { addFile } from '../../engine/emitter.js';
import type { Hook, ModuleBootstrapConfig } from '../../engine/types.js';

export const id = 'auth:oauth';
export const provides: string[] = ['auth:oauth'];
export const requires: string[] = ['core:express', 'db:mongodb', 'auth:jwt'];

export const dependencies: Record<string, string> = {
  'passport': '^0.7.0',
  'passport-google-oauth20': '^2.0.0',
};

export const devDependencies: Record<string, string> = {
  '@types/passport': '^1.0.17',
  '@types/passport-google-oauth20': '^2.0.16',
};

export const envVars = `GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
CLIENT_URL=http://localhost:3000`;

export const hooks: Hook[] = [
  {
    name: 'auth:oauth:app-import',
    targetSlot: 'express:app:imports',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: '',
        imports: [
          `import passport from 'passport';`,
          `import './middlewares/passport.js';`,
          `import authRouter from './routes/auth.routes.js';`
        ],
      };
    },
  },
  {
    name: 'auth:oauth:app-middleware',
    targetSlot: 'express:app:middleware',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: `app.use(passport.initialize());`,
      };
    },
  },
  {
    name: 'auth:oauth:app-routes',
    targetSlot: 'express:app:routes',
    priority: 10,
    async execute(_config: ModuleBootstrapConfig) {
      return {
        content: `app.use('/auth', authRouter);`,
      };
    },
  },
];

export async function bootstrap(_config: ModuleBootstrapConfig): Promise<void> {
  // 1. Passport Configuration
  addFile('src/middlewares/passport.ts', `import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { User } from '../models/user.model.js';

const clientID = process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

passport.use(
  new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL: "/auth/google/callback",
    },
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails?.[0]?.value || \`\${profile.id}@google.oauth\`,
            username: profile.displayName || profile.emails?.[0]?.value?.split('@')[0],
            role: 'user',
          });
        }
        return done(null, user);
      } catch (err) {
        return done(err as Error, undefined);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
`);

  // 2. Auth Routes
  addFile('src/routes/auth.routes.ts', `import { Router, Request, Response } from 'express';
import passport from 'passport';
import { IUser } from '../models/user.model.js';

const router = Router();

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login', session: false }),
  async (req: Request, res: Response) => {
    try {
      const user = req.user as unknown as IUser;
      if (!user) {
        return res.redirect('/login?error=user_not_found');
      }

      const accessToken = user.generateAccessToken();
      const refreshToken = user.generateRefreshToken();

      user.refreshToken = refreshToken;
      await user.save({ validateBeforeSave: false });

      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
      };

      return res
        .cookie("accessToken", accessToken, cookieOptions)
        .cookie("refreshToken", refreshToken, cookieOptions)
        .redirect(process.env.CLIENT_URL || '/');
    } catch (err) {
      return res.redirect('/login?error=oauth_failed');
    }
  }
);

export default router;
`);
}
