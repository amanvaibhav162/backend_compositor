import { addFile } from '../../engine/emitter.js';
import type { Hook, ModuleBootstrapConfig } from '../../engine/types.js';
import { buildDependencies } from '../../engine/catalog.js';

export const id = 'auth:oauth';
export const provides: string[] = ['auth:oauth'];
export const requires: string[] = ['core:express', 'core:database', 'auth:jwt'];

export const dependencies: Record<string, string> = buildDependencies([
  'passport',
  'passport-google-oauth20',
]);

export const devDependencies: Record<string, string> = buildDependencies([
  '@types/passport',
  '@types/passport-google-oauth20',
]);

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

export async function bootstrap(config: ModuleBootstrapConfig): Promise<void> {
  const isPostgres = config.services?.some((s) => s.type === 'postgres') ?? false;

  if (isPostgres) {
    // 1. Passport Configuration (PostgreSQL / Drizzle)
    addFile('src/middlewares/passport.ts', `import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { users } from '../db/schema.js';

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
        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.googleId, profile.id));

        if (existingUser) {
          return done(null, existingUser);
        }

        const email = profile.emails?.[0]?.value || \`\${profile.id}@google.oauth\`;
        const username = profile.displayName || email.split('@')[0];

        const [newUser] = await db
          .insert(users)
          .values({
            googleId: profile.id,
            email,
            username,
            role: 'user',
          })
          .returning();

        return done(null, newUser);
      } catch (err) {
        return done(err as Error, undefined);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    done(null, user || null);
  } catch (err) {
    done(err, null);
  }
});
`);

    // 2. Auth Routes (PostgreSQL / Drizzle)
    addFile('src/routes/auth.routes.ts', `import { Router, Request, Response } from 'express';
import passport from 'passport';
import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { users } from '../db/schema.js';
import { generateAccessToken, generateRefreshToken } from '../utils/auth.helpers.js';

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
      const user = req.user as any;
      if (!user) {
        return res.redirect('/login?error=user_not_found');
      }

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      await db
        .update(users)
        .set({ refreshToken })
        .where(eq(users.id, user.id));

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

  } else {
    // 1. Passport Configuration (MongoDB / Mongoose)
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

    // 2. Auth Routes (MongoDB / Mongoose)
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
}
