import PdfPrinter from "pdfmake";
import { v2 as cloudinary } from "cloudinary";
import { generateInternshipOffer } from "./generateInternshipOffer.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to generate PDF using pdfmake
const generatePDF = async (pdfDefinition) => {
  try {
    // Load font files
    const fonts = {
      Roboto: {
        normal: path.join(__dirname, "fonts", "calibri-regular.ttf"),
        bold: path.join(__dirname, "fonts", "calibri-bold.ttf"),
        italics: path.join(__dirname, "fonts", "calibri-italic.ttf"),
        bolditalics: path.join(__dirname, "fonts", "calibri-bold-italic.ttf"),
      },
    };

    // Create pdfmake printer
    const printer = new PdfPrinter(fonts);

    // Create PDF document
    const pdfDoc = printer.createPdfKitDocument(pdfDefinition);

    // Convert PDF to buffer
    const pdfChunks = [];
    pdfDoc.on("data", (chunk) => pdfChunks.push(chunk));

    const pdfBuffer = await new Promise((resolve, reject) => {
      pdfDoc.on("end", () => resolve(Buffer.concat(pdfChunks)));
      pdfDoc.on("error", reject);
      pdfDoc.end();
    });

    return pdfBuffer;
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw error;
  }
};

// Main function to generate and upload PDF
export const generateAndUploadPDF = async (candidateData, previewMode = false) => {
  try {
    // Generate PDF definition using your existing function
    const pdfDefinition = await generateInternshipOffer(candidateData);
    
    // Generate PDF buffer
    const pdfBuffer = await generatePDF(pdfDefinition);

    if (previewMode) {
      // For preview, just return the buffer without uploading
      return {
        buffer: pdfBuffer,
        url: null
      };
    }

    // Original logic for actual upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            resource_type: "raw",
            folder: "onboarding_documents",
            public_id: `${candidateData.positionType}_Offer_${candidateData.candidateName}_${Date.now()}`,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(pdfBuffer);
    });

    // Return both URL and Buffer for email attachment
    return {
      url: uploadResult.secure_url,
      buffer: pdfBuffer,
    };
  } catch (error) {
    console.error("Error generating/uploading PDF:", error);
    throw error;
  }
};