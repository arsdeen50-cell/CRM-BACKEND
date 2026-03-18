export const otpTemplate = (otp) => `
  <div style="font-family: Arial;">
    <h2>Password Reset Request</h2>
    <p>Your OTP is:</p>
    <h1>${otp}</h1>
    <p>This OTP is valid for 10 minutes.</p>
  </div>
`;
