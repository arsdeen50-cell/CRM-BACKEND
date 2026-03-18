export const onboardingTemplate = (candidateName) => {
    return `
      <div style="max-width:600px;margin:auto;background:#f8f9fc;border:1px solid #e5e5e5;border-radius:10px;padding:24px;font-family:'Segoe UI', Arial, sans-serif;">
        
        <!-- Header -->
        <div style="background:#0066cc;color:white;padding:16px 0;border-radius:8px 8px 0 0;text-align:center;">
          <h2 style="margin:0;font-size:22px;">Welcome to the Onboarding Journey!</h2>
        </div>
  
        <!-- Body -->
        <div style="padding:20px;background:white;border-radius:0 0 8px 8px;">
          <p style="font-size:16px;color:#333;">
            Hi <strong>${candidateName}</strong>,
          </p>
  
          <p style="font-size:15px;color:#555;line-height:1.6;">
            We’re excited to inform you that your <strong>onboarding process</strong> is currently 
            <span style="color:#0066cc;font-weight:600;">In Progress</span>.
            Our HR team is carefully reviewing your documents and information to ensure everything is in order.
          </p>
  
          <p style="font-size:15px;color:#555;line-height:1.6;">
            Once the review is complete, you’ll receive further instructions regarding the next steps.
            Please keep an eye on your inbox for updates.
          </p>
  
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  
          <p style="font-size:14px;color:#777;">
            If you have any questions or need assistance, feel free to reach out to our HR department at
            <a href="mailto:arsdeen50@gmail.com" style="color:#0066cc;text-decoration:none;">arsdeen50@gmail.com</a>.
          </p>
  
          <!-- Signature first, then image -->
          <div style="margin-top:24px;color:#555;font-size:14px;">
            <p style="margin:0;">
              Warm regards, <br />
              <strong style="color:#0066cc;">The HR Team</strong><br />
            </p>
          </div>
  
          <!-- Image at the bottom left -->
          <div style="text-align:left;margin-top:16px;">
            <img 
              src="https://res.cloudinary.com/dr2krdnae/image/upload/v1762861750/onboarding_documents/rj3u8yzz2z3zx5lwo9jy.jpg" 
              alt="Onboarding Footer" 
              style="width:85px;border-radius:8px;"
            />
          </div>
        </div>
      </div>
    `;
  };
  