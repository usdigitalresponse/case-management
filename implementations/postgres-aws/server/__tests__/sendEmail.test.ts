import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  SendEmailCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

describe('sendEmail', () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends via SES when SES_SENDER_EMAIL is configured', async () => {
    vi.stubEnv('SES_SENDER_EMAIL', 'no-reply@example.com');
    const { sendEmail } = await import('../src/email/sendEmail');

    await sendEmail('vendor@example.com', 'Subject', 'Body text');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentCommand = sendMock.mock.calls[0]?.[0] as {
      FromEmailAddress: string;
      Destination: { ToAddresses: string[] };
    };
    expect(sentCommand.FromEmailAddress).toBe('no-reply@example.com');
    expect(sentCommand.Destination.ToAddresses).toEqual(['vendor@example.com']);
  });

  it('falls back to logging when SES_SENDER_EMAIL is unset, without calling SES', async () => {
    const { sendEmail } = await import('../src/email/sendEmail');

    await sendEmail('vendor@example.com', 'Subject', 'Body text');

    expect(sendMock).not.toHaveBeenCalled();
  });
});
