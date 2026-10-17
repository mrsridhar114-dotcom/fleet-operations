// Sends email through a Gmail account (GMAIL_USER + GMAIL_APP_PASSWORD in Vercel's Environment Variables).
// Used only for password-reset codes.
export const mailReady = () => !!(process.env.MAIL_DEV_LOG || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));
let transport = null;
export async function sendMail({ to, subject, text, html }) {
  if (process.env.MAIL_DEV_LOG) { // local testing only: write the message to a file instead of sending it
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.MAIL_DEV_LOG, JSON.stringify({ to, subject, text }) + "\n");
    return;
  }
  if (!mailReady()) throw Object.assign(new Error("Email isn't set up for this app yet."), { status: 503 });
  if (!transport) {
    const nodemailer = (await import("nodemailer")).default;
    transport = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, "") } });
  }
  await transport.sendMail({ from: `"${process.env.MAIL_FROM_NAME || "VBS Fleet"}" <${process.env.GMAIL_USER}>`, to, subject, text, html });
}
