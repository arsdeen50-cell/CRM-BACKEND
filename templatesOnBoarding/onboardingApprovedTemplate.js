export const onboardingApprovedTemplate = (candidateName, positionType, email, password, empId) => {
    return `
       <div style="max-width:600px;margin:auto;background:#f8f9fc;border:1px solid #e5e5e5;border-radius:10px;padding:24px;font-family:'Segoe UI', Arial, sans-serif;">
      
      <div style="background:#28a745;color:white;padding:16px 0;border-radius:8px 8px 0 0;text-align:center;">
        <h2 style="margin:0;font-size:22px;">Congratulations, ${candidateName}!</h2>
      </div>

      <div style="padding:20px;background:white;border-radius:0 0 8px 8px;">
        <p style="font-size:16px;color:#333;">
          Dear <strong>${candidateName}</strong>,
        </p>

        <p style="font-size:15px;color:#555;line-height:1.6;">
          We’re thrilled to inform you that your onboarding has been <strong style="color:#28a745;">Approved</strong>! 🎉  
          Please find your official <strong>${positionType} Offer Letter</strong> attached with this email.
        </p>

        <div style="background:#f0f8ff;border-left:4px solid #28a745;padding:15px;margin:20px 0;">
          <h3 style="margin:0 0 10px 0;color:#333;">Your Login Credentials</h3>
          <p style="margin:5px 0;"><strong>Employee ID:</strong> ${empId}</p>
          <p style="margin:5px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin:5px 0;"><strong>Password:</strong> ${password}</p>
          <p style="margin:10px 0 0 0;font-size:12px;color:#666;">
            ⚠️ Please change your password after first login for security purposes.
          </p>
        </div>

        <p style="font-size:15px;color:#555;line-height:1.6;">
          You can now login to our portal using the credentials provided above.
        </p>

        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />

        <p style="font-size:14px;color:#777;">
          For assistance, contact us at 
          <a href="mailto:arsdeen50@gmail.com" style="color:#28a745;text-decoration:none;">arsdeen50@gmail.com</a>.
        </p>

        <p style="margin-top:24px;color:#555;font-size:14px;">
          Warm regards, <br />
          <strong style="color:#28a745;">The HR Team</strong><br />
          <span style="color:#999;">Your Company Pvt. Ltd.</span>
        </p>

        <div style="text-align:left;margin-top:10px;">
          <img 
            src="https://res.cloudinary.com/dr2krdnae/image/upload/v1762861750/onboarding_documents/rj3u8yzz2z3zx5lwo9jy.jpg" 
            alt="Company Footer"
            style="width:140px;border-radius:8px;"
          />
        </div>
      </div>
    </div>
    `;
  };
  