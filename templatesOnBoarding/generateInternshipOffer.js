import moment from "moment";
import axios from "axios";

const calculateMonthsDifference = (startDate, endDate) => {
  const start = moment.utc(startDate);
  const end = moment.utc(endDate);
  
  const startYear = start.year();
  const startMonth = start.month();
  const endYear = end.year();
  const endMonth = end.month();
  
  const months = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  
  return `${months} month${months !== 1 ? 's' : ''}`;
};

const getBase64FromUrl = async (url) => {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  const mimeType = response.headers["content-type"];
  return `data:${mimeType};base64,${base64}`;
};

export const generateInternshipOffer = async(candidateData) => {
  const formatNumber = (num) => {
    return new Intl.NumberFormat("en-IN").format(num || 0);
  };

  try {
    const headerImageUrl =
      "https://res.cloudinary.com/dr2krdnae/image/upload/v1762861750/onboarding_documents/rj3u8yzz2z3zx5lwo9jy.jpg";

    const signature1Url =
      "https://res.cloudinary.com/dr2krdnae/image/upload/v1762863279/onboarding_documents/xextqfjszcviet9f4hbu.jpg";
    const signature2Url =
      "https://res.cloudinary.com/dr2krdnae/image/upload/v1762863278/onboarding_documents/ntnhkjk74mdsa5ky88ss.jpg";

    const headerImage = await getBase64FromUrl(headerImageUrl);
    const signature1 = await getBase64FromUrl(signature1Url);
    const signature2 = await getBase64FromUrl(signature2Url);

    const designation = candidateData?.designation || "Social Media Marketing Intern";
    const offeredFixedCtc = candidateData?.offeredFixedCtc || 4000;
    const offeredVariableCtc = candidateData?.offeredVariableCtc || 1000;
    const offeredTotalCtc = candidateData?.offeredTotalCtc || 5000;

    return {
      pageMargins: [40, 60, 40, 80], // Increased bottom margin for footer

      header: function (currentPage, pageCount) {
        return [
          {
            stack: [
              {
                image: headerImage,
                width: 120,
                height: 40,
                alignment: "center",
                margin: [0, 0, 0, 3],
              },
              {
                canvas: [
                  {
                    type: "line",
                    x1: 0,
                    y1: 0,
                    x2: 515,
                    y2: 0,
                    lineWidth: 0.5,
                    lineColor: "#dddddd",
                  },
                ],
                margin: [0, 3, 0, 3],
              }
            ],
            alignment: "center",
            margin: [0, 5, 0, 0],
            id: "stickyHeader",
          },
        ];
      },

      footer: function (currentPage, pageCount) {
        return [
          // Page number footer
          {
            stack: [
              {
                canvas: [
                  {
                    type: "line",
                    x1: 0,
                    y1: 0,
                    x2: 515,
                    y2: 0,
                    lineWidth: 0.5,
                    lineColor: "#cccccc",
                  },
                ],
                margin: [0, 0, 0, 5],
              },
              {
                text: `Page ${currentPage} of ${pageCount}`,
                alignment: "center",
                fontSize: 7,
                color: "#666666",
                margin: [0, 0, 0, 5],
              },
            ],
            margin: [0, 10, 0, 0],
          },
          // Address footer (appears on all pages at the bottom)
          {
            text: "4th Floor Khan House BR Patil Marg Trombay 400088",
            style: "footerText",
            alignment: "center",
            margin: [0, 5, 0, 10],
          }
        ];
      },

      content: [
        {
          text: `${candidateData?.positionType} Offer - ${designation}`,
          style: "title",
          alignment: "center",
          margin: [0, 10, 0, 15],
        },
        {
          text: `Dear ${candidateData?.fullName || "Candidate"},`,
          style: "defaultStyle",
          margin: [0, 0, 0, 10],
        },
        {
          text: [
            "We are pleased to offer you the position of ",
            { text: designation, bold: true },
            " at ",
            { text: "Arsdeen", bold: true },
            `. Your creativity, communication skills, and enthusiasm for ${designation} have impressed us, and we're excited to welcome you to our growing team.`,
          ],
          style: "defaultStyle",
          margin: [0, 0, 0, 15],
          alignment: "justify",
        },

        {
          text: `${candidateData?.positionType} Details`,
          style: "subheader",
          margin: [0, 0, 0, 10],
        },
        {
          ul: [
            candidateData?.doe 
            ?
              `This is a ${calculateMonthsDifference(candidateData.doj, candidateData.doe)} ${candidateData?.positionType?.toLowerCase() || 'position'}, starting from ${moment
                .utc(candidateData?.doj)
                .format("MMMM D, YYYY")} and ending on ${moment
                .utc(candidateData?.doe)
                .format("MMMM D, YYYY")}`
            : 
              `This is a ${candidateData?.positionType || 'Full Time'} position starting from ${moment
                .utc(candidateData?.doj)
                .format("MMMM D, YYYY")}`,
            `You are expected to work 8 hours per day (including breaks) in an on-site role.`,
            `You will report to your assigned mentor throughout the  ${candidateData?.positionType}.`,
          ],
          style: "defaultStyle",
          margin: [0, 0, 0, 10],
        },

        {
          text: "Stipend Breakdown",
          style: "subheader",
          margin: [0, 0, 0, 5],
        },
        {
          style: "tableExample",
          table: {
            widths: ["70%", "30%"],
            body: [
              [
                { text: "Component", bold: true, fillColor: "#eeeeee" },
                {
                  text: "Amount (INR)",
                  bold: true,
                  fillColor: "#eeeeee",
                  alignment: "center",
                },
              ],
              [
                { text: `${candidateData?.positionType} fixed amount` },
                { text: formatNumber(offeredFixedCtc), alignment: "center" },
              ],
              [
                { text: "Travel Allowance" },
                { text: formatNumber(offeredVariableCtc), alignment: "center" },
              ],
              [
                { text: "Total", bold: true },
                { text: formatNumber(offeredTotalCtc), bold: true, alignment: "center" },
              ],
            ],
          },
          margin: [0, 0, 0, 15],
        },

        {
          text: "Note:",
          style: "noteHeader",
          margin: [0, 0, 0, 5],
        },
        {
          text: `The stipend for this ${candidateData?.positionType} will be ₹${formatNumber(offeredTotalCtc)} per month, along with applicable performance incentives. Performance incentives of ₹1,000 per month may be awarded based on your contribution, creativity, and overall performance during the ${candidateData?.positionType}.`,
          style: "noteText",
          margin: [0, 0, 0, 5],
        },

        // Reduced margins for Key Responsibilities section
        {
          text: "Key Responsibilities",
          style: "subheader",
          margin: [0, 0, 0, 5], // Reduced from 10 to 8
        },
        {
          ul: candidateData?.keyResponsibilities && candidateData.keyResponsibilities.length > 0 
            ? candidateData.keyResponsibilities.map(responsibility => responsibility)
            : [
                "Developing creative strategies for brand awareness and audience growth.",
                "Managing and posting on social media platforms such as Instagram and Facebook.",
                "Planning and executing engaging content calendars and campaigns.",
                "Analyzing engagement metrics to optimize performance.",
                "Collaborating with the design and media team to produce high-impact visuals and reels.",
                "Monitoring trends and implementing innovative social media ideas to boost engagement.",
              ],
          style: "defaultStyle",
          margin: [0, 0, 0, 10],
        },

        // Reduced margins for What You'll Gain section
        {
          text: "What You'll Gain",
          style: "subheader",
          margin: [0, 0, 0, 5], // Reduced from 10 to 8
        },
        {
          text: `During your ${candidateData?.positionType} at Arsdeen, you will gain real-world experience in managing ${designation} strategies for a growing fashion and lifestyle brand. You will strengthen your skills in:`,
          style: "defaultStyle",
          margin: [0, 0, 0, 5], // Reduced from 10 to 8
        },
        {
          ul: candidateData?.whatYoullGain && candidateData.whatYoullGain.length > 0 
            ? candidateData.whatYoullGain.map(gain => gain)
            : [
                "Content planning and social media strategy execution.",
                "Performance analytics and audience engagement optimization.",
                "Brand communication and storytelling.",
                "Influencer collaboration and trend-based marketing.",
              ],
          style: "defaultStyle",
          margin: [0, 0, 0, 5],
        },

        {
          text: "You will also receive mentorship from experienced media professionals, the opportunity to pitch and execute your own creative ideas, and contribute meaningfully to live brand campaigns.",
          style: "defaultStyle",
          margin: [0, 0, 0, 5],
        },

        {
          text: `Upon successful completion of the ${candidateData?.positionType}, you will receive:`,
          style: "defaultStyle",
          margin: [0, 0, 0, 0],
        },
        {
          ul: [
            `Certificate of ${candidateData?.positionType} & Letter of Recommendation.`,
            "Exclusive Arsdeen merchandise during new releases and early access to campaigns.",
            {
              text: [
                "Possibility of a ",
                { text: "full-time role at Arsdeen", bold: true },
                " based on your performance."
              ]
            },
          ],
          style: "defaultStyle",
          margin: [0, 0, 0, 2],
        },

        {
          text: "Terms & Conditions",
          style: "title",
          alignment: "center",
          pageBreak: "before",
          margin: [0, 10, 0, 20],
        },

        {
          ol: [
            { text: `Confidentiality: You agree to keep all proprietary and confidential information strictly confidential during and after the ${candidateData?.positionType}.` },
            { text: "Termination: Violation of company policies, misconduct, or breach of confidentiality may result in immediate termination." },
            { text: "Legal Action: Arsdeen reserves the right to pursue legal action in the event of a confidentiality breach or misconduct." },
            { text: "Performance Review: Potential full-time employment will be based on your performance and alignment with company needs." },
            { text: "Promotion Opportunity: Exceptional performance may lead to a promotion opportunity." },
            { text: "Monthly Incentives: Eligible for monthly performance-based bonuses based on your engagement impact." },
            { text: "Post-Internship Review: Upon completion, compensation may be revised if offered a full-time role based on your performance." },
          ],
          style: "defaultStyle",
          margin: [0, 0, 0, 30],
        },

        {
          text: "Acceptance & Confirmation",
          style: "subheader",
          margin: [0, 0, 0, 10],
        },
        {
          text: `To confirm your acceptance, please sign and return this letter by ${moment
            .utc(candidateData?.doj)
            .format("MMM D, YYYY")}. For any queries, reach out at Ardeen50@gmail.com.`,
          style: "defaultStyle",
          margin: [0, 0, 0, 20],
        },
        {
          text: "We look forward to working with you and seeing your creative input come to life.",
          style: "defaultStyle",
          margin: [0, 0, 0, 20],
        },

        { text: "Warm regards,", style: "defaultStyle", margin: [0, 0, 0, 10] },

        {
          columns: [
            {
              width: "50%",
              stack: [
                { image: signature1, width: 80, margin: [0, 10, 0, 5] },
                { text: "Fardeen", bold: true },
                { text: "Co-Founder" },
              ],
            },
            {
              width: "50%",
              stack: [
                { image: signature2, width: 80, margin: [0, 10, 0, 5] },
                { text: "Arsalan", bold: true },
                { text: "Co-Founder" },
              ],
            },
          ],
          margin: [0, 0, 0, 30],
        },

        {
          text: `${candidateData?.positionType} Acceptance`,
          style: "subheader",
          margin: [0, 0, 0, 10],
        },
        {
          text: `I, ${candidateData?.candidateName || "Candidate"}, accept the offer for the ${designation} at Arsdeen as outlined above.`,
          style: "defaultStyle",
          margin: [0, 0, 0, 20],
        },

        {
          columns: [
            { width: "50%", text: "Signature: ________________" },
            { width: "50%", text: "Date: ________________" },
          ],
          margin: [0, 0, 0, 10],
        },

        // Removed the standalone address from content since it's now in footer
      ],

      styles: {
        title: { fontSize: 16, bold: true },
        subheader: { fontSize: 12, bold: true, decoration: "underline" },
        defaultStyle: { fontSize: 10, lineHeight: 1.3 },
        noteHeader: { fontSize: 10, bold: true, italics: true },
        noteText: { fontSize: 10, italics: true },
        footerText: { fontSize: 8, color: "#666666", bold: true }, 
      },

      defaultStyle: {
        fontSize: 10,
        lineHeight: 1.3,
      },
    };
  } catch (error) {
    console.error("Error generating Internship Offer:", error);
    throw error;
  }
};