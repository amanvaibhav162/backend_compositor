import { addFile } from '../../engine/emitter.js';

export const id = 'auth:oauth';
export const provides = ['auth:oauth'];
export const requires = ['db:mongodb', 'core:express'];
export const dependencies = {
  'passport': '^0.7.0',
  'passport-google-oauth20': '^2.0.0',
};
export const envVars = `GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret`;

export const hooks = [
  {
    name: 'auth:oauth:app-import',
    targetSlot: 'express:app:imports',
    priority: 10,
    async execute(_config) {
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
    async execute(_config) {
      return {
        content: `app.use(passport.initialize());`,
      };
    },
  },
  {
    name: 'auth:oauth:app-routes',
    targetSlot: 'express:app:routes',
    priority: 10,
    async execute(_config) {
      return {
        content: `app.use('/auth', authRouter);`,
      };
    },
  },
];

export async function bootstrap(config) {
  addFile('src/middlewares/passport.js', `import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/user.model.js';

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async function(accessToken, refreshToken, profile, cb) {
    try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
            user = await User.create({
                googleId: profile.id,
                email: profile.emails[0].value,
                username: profile.displayName,
            });
        }
        return cb(null, user);
    } catch (err) {
        return cb(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
`);

  addFile('src/routes/auth.routes.js', `import { Router } from 'express';
import passport from 'passport';

const router = Router();

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    res.redirect('/');
  });

export default router;
`);
}
