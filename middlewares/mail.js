import dotenv from "dotenv";
import { sendEmail } from "../utils/mailer.js";
dotenv.config();

// Older call style used by onboarding, projects and the follow-up digest; sends through the shared mailer
// (Gmail, SMTP or Microsoft 365, whichever the server is set up for).
const sendMail = async (to, subject, htmlTemplate, cc = [], bcc = [], attachments = []) => {
  try {
    return await sendEmail({ to, subject, html: htmlTemplate, cc, bcc, attachments });
  } catch (error) {
    console.error("Error sending mail:", error);
    throw error;
  }
};

export default sendMail;
