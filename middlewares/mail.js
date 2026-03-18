import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const sendMail = (to, subject, htmlTemplate, cc = [], bcc = [], attachments = []) => {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "GMAIL",
      // production code
      port: 465,
      secure: true,

      // development code
      // port: 587,
      // secure: false,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
      // development code
//       tls: {
//   rejectUnauthorized: false,
// },
    });

    const mailOptions = {
      from: process.env.EMAIL,
      to,
      cc,
      bcc,
      subject,
      html: htmlTemplate,
      attachments,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending mail:", error);
        return reject(error);
      }
      resolve(info);
    });
  });
};

export default sendMail;
