import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieSession from 'cookie-session';
import passport from 'passport';
import { configureGoogleAuth } from './auth/googleStrategy';
import { createAuthRouter } from './routes/auth';
import casesRouter from './routes/cases';
import peopleRouter from './routes/people';
import referenceDataRouter from './routes/referenceData';

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
}

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(
    cookieSession({
      name: 'session',
      secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    }),
  );
  app.use(passport.initialize());

  const googleEnabled = configureGoogleAuth();
  if (!googleEnabled) {
    // eslint-disable-next-line no-console
    console.warn('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set; Google sign-in is disabled.');
  }

  app.use('/auth', createAuthRouter({ googleEnabled, devLoginEnabled: !isProduction }));
  app.use('/api/cases', casesRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/reference-data', referenceDataRouter);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${port}`);
  });
}
