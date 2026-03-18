export const documentsSubmittedTemplate = (candidateName) => `
  <div style="font-family: Arial, sans-serif; padding: 20px;">
    <h2 style="color: #16a34a;">Candidate Form Submitted</h2>
    <p>Dear HR Team,</p>
    <p>The candidate <strong>${candidateName}</strong> has successfully submitted their onboarding form and documents.</p>
    <p>Please review their submission in the admin portal.</p>
    <br/>
    <p>Regards,<br/>Onboarding System</p>
  </div>
`;
