// Thin send-an-email abstraction, used today only by the magic-link flow
// (../routes/auth.ts). Sends via AWS SES when SES_SENDER_EMAIL is
// configured; otherwise falls back to logging the message, the same
// "optional, falls back" shape as ../auth/oidcProviders.ts's
// configureOidcProviders, so local dev needs no AWS setup. The SES client
// resolves credentials/region the normal AWS SDK way (env vars, an ECS
// task role in production, etc.) — nothing app-specific to configure
// beyond the sender address.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

let sesClient: SESv2Client | undefined;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const senderEmail = process.env.SES_SENDER_EMAIL;
  if (!senderEmail) {
    // eslint-disable-next-line no-console
    console.log(`[email, no SES_SENDER_EMAIL configured] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    return;
  }

  sesClient ??= new SESv2Client({});
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: senderEmail,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Text: { Data: text } },
        },
      },
    }),
  );
}
