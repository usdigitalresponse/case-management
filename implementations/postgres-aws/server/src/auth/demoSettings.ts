// On by default in development; production turns each on only when opted in.
function demoSetting(name: string): boolean {
  const value = process.env[name];
  return value ? value === 'true' : process.env.NODE_ENV !== 'production';
}

export const demoLoginEnabled = demoSetting('DEMO_LOGIN_ENABLED');
export const externalDemoLoginEnabled = demoSetting('EXTERNAL_DEMO_LOGIN_ENABLED');
