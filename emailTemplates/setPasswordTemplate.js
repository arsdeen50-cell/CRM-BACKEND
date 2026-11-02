const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// "Choose your password" email: a one-time link instead of a password in the email
export const setPasswordTemplate = ({ fullname, email, url, hours, empId }) => `
  <div style="font-family: Arial; max-width: 560px;">
    <h2>Set your CRM password</h2>
    <p>Hi ${esc(fullname)},</p>
    <p>Your CRM login is <strong>${esc(email)}</strong>${empId ? ` (employee code <strong>${esc(empId)}</strong>)` : ""}. Choose your password with this link:</p>
    <p><a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Set my password</a></p>
    <p style="color:#555;font-size:13px">The link works once and expires in ${hours} hours. If it has expired, use "Forgot password?" on the login page or ask HR for a new link.</p>
  </div>
`;
