// Demo sign-ins are on by default for local development; a production
// deployment exposes each only when explicitly opted in (the hosted
// synthetic-data demo does).
function demoSetting(name: string): boolean {
  const value = process.env[name];
  return value ? value === 'true' : process.env.NODE_ENV !== 'production';
}

export const demoLoginEnabled = demoSetting('DEMO_LOGIN_ENABLED');
export const externalDemoLoginEnabled = demoSetting('EXTERNAL_DEMO_LOGIN_ENABLED');
