export const otpTemplate = (otp) => `
  <div style="font-family: Arial;">
    <h2>Password Reset Request</h2>
    <p>Your OTP is:</p>
    <h1>${otp}</h1>
    <p>This code is valid for 10 minutes and can be used once. If you didn't ask to reset your password, ignore this email.</p>
  </div>
`;
