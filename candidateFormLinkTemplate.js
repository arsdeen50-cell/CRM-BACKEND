export const candidateFormLinkTemplate = (candidateName, formUrl) => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Complete Your Onboarding Form</title>
          <style>
              body {
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                  line-height: 1.6;
                  color: #333;
                  margin: 0;
                  padding: 0;
                  background-color: #f4f4f4;
              }
              .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                  background-color: #ffffff;
                  border-radius: 10px;
                  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              }
              .header {
                  text-align: center;
                  padding: 20px 0;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  border-radius: 10px 10px 0 0;
                  color: white;
              }
              .header h1 {
                  margin: 0;
                  font-size: 24px;
              }
              .content {
                  padding: 30px;
              }
              .button {
                  display: inline-block;
                  padding: 12px 30px;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  text-decoration: none;
                  border-radius: 5px;
                  font-weight: bold;
                  margin: 20px 0;
                  text-align: center;
              }
              .button:hover {
                  background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%);
              }
              .instructions {
                  background-color: #f8f9fa;
                  padding: 15px;
                  border-radius: 5px;
                  border-left: 4px solid #667eea;
                  margin: 20px 0;
              }
              .footer {
                  text-align: center;
                  padding: 20px;
                  color: #666;
                  font-size: 14px;
                  border-top: 1px solid #eee;
              }
              .urgent {
                  color: #e74c3c;
                  font-weight: bold;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Complete Your Onboarding Form</h1>
              </div>
              <div class="content">
                  <h2>Hello ${candidateName},</h2>
                  
                  <p>We're excited to move forward with your onboarding process! Please complete your candidate information form by clicking the button below:</p>
                  
                  <div style="text-align: center;">
                      <a href="${formUrl}" class="button">Complete Your Onboarding Form</a>
                  </div>
                  
                  <div class="instructions">
                      <h3>📋 What you'll need to complete the form:</h3>
                      <ul>
                          <li>Personal identification documents</li>
                          <li>Educational certificates</li>
                          <li>Previous employment details</li>
                          <li>Bank account information</li>
                          <li>Emergency contact details</li>
                      </ul>
                  </div>
                  
                  <p class="urgent">⏰ Please complete this form within 48 hours to avoid delays in your onboarding process.</p>
                  
                  <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
                  <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">
                      ${formUrl}
                  </p>
                  
                  <p>If you have any questions or need assistance, please don't hesitate to contact our HR team.</p>
                  
                  <p>Best regards,<br>HR Team</p>
              </div>
              <div class="footer">
                  <p>This is an automated message. Please do not reply to this email.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  };