// Sends through SES when SES_SENDER_EMAIL is set (credentials found the usual AWS SDK way), else logs the message.
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
