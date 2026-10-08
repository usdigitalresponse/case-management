import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieSession from 'cookie-session';
import passport from 'passport';
import { configureOidcProviders } from './auth/oidcProviders';
import { createAuthRouter } from './routes/auth';
import casesRouter from './routes/cases';
import peopleRouter from './routes/people';
import clientsRouter from './routes/clients';
import professionalsRouter from './routes/professionals';
import staffRouter from './routes/staff';
import invoicesRouter from './routes/invoices';
import myCasesRouter from './routes/myCases';
import portalRouter from './routes/portal';
import referenceDataRouter from './routes/referenceData';
import { AppError } from './errors';

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
}

// Demo sign-ins are on by default for local development; a production
// deployment exposes each only when explicitly opted in (the hosted
// synthetic-data demo does).
function demoSetting(name: string): boolean {
  const value = process.env[name];
  return value ? value === 'true' : !isProduction;
}
const demoLoginEnabled = demoSetting('DEMO_LOGIN_ENABLED');
const externalDemoLoginEnabled = demoSetting('EXTERNAL_DEMO_LOGIN_ENABLED');

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

  const oidcProviders = configureOidcProviders();
  if (oidcProviders.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('No OIDC provider credentials configured; SSO sign-in is disabled.');
  }

  app.use('/auth', createAuthRouter({ oidcProviders, demoLoginEnabled, externalDemoLoginEnabled }));
  app.use('/api/cases', casesRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/professionals', professionalsRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/my-cases', myCasesRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/reference-data', referenceDataRouter);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      if (err.status >= 500) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
      res.status(err.status).json(err.toResponseBody());
      return;
    }
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
