import { GoOnBoarding } from "../models/GoOnBoarding.model.js";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import getDataUri from "../utils/datauri.js";
import { onboardingTemplate } from "../templatesOnBoarding/onboardingTemplate.js";
import sendMail from "../middlewares/mail.js";
import { generateAndUploadPDF } from "../templatesOnBoarding/generateAndUploadPDF.js";
import { onboardingApprovedTemplate } from "../templatesOnBoarding/onboardingApprovedTemplate.js";
import { candidateFormLinkTemplate } from "../templatesOnBoarding/candidateFormLinkTemplate.js";
import { documentsSubmittedTemplate } from "../templatesOnBoarding/documentsSubmittedTemplate.js";

/* ---------------------- Create GoOnBoarding ---------------------- */
export const createGoOnBoarding = async (req, res) => {
  try {
    const onboardingData = { ...req.body };

    // Handle file uploads
    const fileFields = {
      uploadProfile: "uploadProfile",
      aadharFront: "aadharFront",
      aadharBack: "aadharBack",
      resume: "resume",
      chequePassBookImage: "chequePassBookImage",
      educationCertificateImage: "educationCertificateImage",
      previousEmployeImage: "previousEmployeImage",
    };

    if (req.files && req.files.length > 0) {
      // Handle single file uploads
      for (const [field, fieldName] of Object.entries(fileFields)) {
        const file = req.files.find((f) => f.fieldname === field);
        if (file) {
          const fileuri = getDataUri(file);
          const cloudResponse = await cloudinary.uploader.upload(
            fileuri.content,
            {
              resource_type: "auto",
              folder: "onboarding_documents",
            }
          );

          onboardingData[fieldName] = {
            fileName: file.originalname,
            fileUrl: cloudResponse.secure_url,
          };
        }
      }

      // Handle multiple salary slips
      const salarySlips = req.files.filter(
        (f) => f.fieldname === "lastThreeMonthSalary"
      );
      if (salarySlips.length > 0) {
        onboardingData.lastThreeMonthSalary = [];
        for (const file of salarySlips) {
          const fileuri = getDataUri(file);
          const cloudResponse = await cloudinary.uploader.upload(
            fileuri.content,
            {
              resource_type: "auto",
              folder: "onboarding_documents",
            }
          );

          onboardingData.lastThreeMonthSalary.push({
            fileName: file.originalname,
            fileUrl: cloudResponse.secure_url,
          });
        }
      }
    }

    // Validate required fields
    if (
      !onboardingData.candidateName ||
      !onboardingData.email ||
      !onboardingData.mobileNo
    ) {
      return res.status(400).json({
        success: false,
        message: "Candidate name, email, and mobile number are required fields",
      });
    }

    // Check if candidate with email already exists
    const existingCandidate = await GoOnBoarding.findOne({
      email: onboardingData.email,
    });
    // if (existingCandidate) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Candidate with this email already exists",
    //   });
    // }

    const newOnboarding = new GoOnBoarding(onboardingData);
    await newOnboarding.save();

    res.status(201).json({
      success: true,
      message: "Onboarding created successfully",
      onboarding: newOnboarding,
    });
  } catch (err) {
    console.error("Error creating onboarding:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((error) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: errors,
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ---------------------- Get All GoOnBoardings ---------------------- */
export const getGoOnBoardings = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter object
    const filter = {};

    // Search filter
    if (search) {
      filter.$or = [
        { candidateName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobileNo: { $regex: search, $options: "i" } },
        { designation: { $regex: search, $options: "i" } },
      ];
    }

    // Status filter
    if (status) {
      filter.candidateStatus = status;
    }

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Execute query with pagination
    const onboardings = await GoOnBoarding.find(filter)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select("-__v");

    // Get total count for pagination
    const totalCount = await GoOnBoarding.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      onboardings,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching onboardings:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching onboardings",
    });
  }
};

/* ---------------------- Get GoOnBoarding By ID ---------------------- */
export const getGoOnBoardingById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding ID",
      });
    }

    const onboarding = await GoOnBoarding.findById(id).select("-__v");

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "Onboarding record not found",
      });
    }

    res.status(200).json({
      success: true,
      onboarding,
    });
  } catch (err) {
    console.error("Error fetching onboarding:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching onboarding",
    });
  }
};


export const updateGoOnBoarding = async (req, res) => {
    try {
      const { id } = req.params;
  
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid onboarding ID",
        });
      }
  
      const updateData = { ...req.body };
  
      // --- Handle file uploads (same as before) ---
      const fileFields = {
        uploadProfile: "uploadProfile",
        aadharFront: "aadharFront",
        aadharBack: "aadharBack",
        resume: "resume",
        chequePassBookImage: "chequePassBookImage",
        // educationCertificateImage: "educationCertificateImage",
        // previousEmployeImage: "previousEmployeImage",
      };
  
      if (req.files && req.files.length > 0) {
        for (const [field, fieldName] of Object.entries(fileFields)) {
          const file = req.files.find((f) => f.fieldname === field);
          if (file) {
            const fileuri = getDataUri(file);
            const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
              resource_type: "auto",
              folder: "onboarding_documents",
            });
  
            updateData[fieldName] = {
              fileName: file.originalname,
              fileUrl: cloudResponse.secure_url,
            };
          }
        }
  
        // Handle multiple salary slips
        const salarySlips = req.files.filter((f) => f.fieldname === "lastThreeMonthSalary");
        if (salarySlips.length > 0) {
          if (!updateData.lastThreeMonthSalary) {
            updateData.lastThreeMonthSalary = [];
          }
          for (const file of salarySlips) {
            const fileuri = getDataUri(file);
            const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
              resource_type: "auto",
              folder: "onboarding_documents",
            });
            updateData.lastThreeMonthSalary.push({
              fileName: file.originalname,
              fileUrl: cloudResponse.secure_url,
            });
          }
        }
      }

           // Handle multiple education certificate images
           const educationCertificates = req.files.filter((f) => f.fieldname === "educationCertificateImage");
           if (educationCertificates.length > 0) {
             updateData.educationCertificateImage = [];
             for (const file of educationCertificates) {
               const fileuri = getDataUri(file);
               const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
                 resource_type: "auto",
                 folder: "onboarding_documents",
               });
               updateData.educationCertificateImage.push({
                 fileName: file.originalname,
                 fileUrl: cloudResponse.secure_url,
               });
             }
           }

              // Handle multiple previous employment images
      const previousEmployment = req.files.filter((f) => f.fieldname === "previousEmployeImage");
      if (previousEmployment.length > 0) {
        updateData.previousEmployeImage = [];
        for (const file of previousEmployment) {
          const fileuri = getDataUri(file);
          const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
            resource_type: "auto",
            folder: "onboarding_documents",
          });
          updateData.previousEmployeImage.push({
            fileName: file.originalname,
            fileUrl: cloudResponse.secure_url,
          });
        }
      }
  
      // --- Find the existing record before updating ---
      const existingOnboarding = await GoOnBoarding.findById(id);
      if (!existingOnboarding) {
        return res.status(404).json({
          success: false,
          message: "Onboarding record not found",
        });
      }
  
      // --- Perform update ---
      const updatedOnboarding = await GoOnBoarding.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).select("-__v");
  
      // --- Send email only if candidateStatus changed to 'In Progress' ---
      const prevStatus = existingOnboarding.candidateStatus;
      const newStatus = updateData.candidateStatus;

      if (prevStatus !== "Send Link To Candidate" && newStatus === "Send Link To Candidate") {
        try {
          // Generate candidate form URL
          const candidateFormUrl = `${process.env.CLIENT_SERVER}/candidate-form/${id}`;
          
          const htmlContent = candidateFormLinkTemplate(updatedOnboarding.candidateName, candidateFormUrl);
  
          const to = updatedOnboarding.email;
          const cc = ["arsdeen50@gmail.com"];
          const bcc = ["sayedfardeen815@gmail.com", "shaikhfazil180@gmail.com"];
  
          await sendMail(
            to,
            `Complete Your Onboarding Form - ${updatedOnboarding.candidateName}`,
            htmlContent,
            cc,
            bcc
          );
  
          console.log(`Candidate form link sent to ${updatedOnboarding.email}`);
          console.log(`Candidate form URL: ${candidateFormUrl}`);
        } catch (mailError) {
          console.error("Email sending failed (Send Link To Candidate):", mailError);
        }
      }

       // 3. Documents Submitted → Notify HR
    if (prevStatus !== "Documents Submitted" && newStatus === "Documents Submitted") {
      try {
        const htmlContent = documentsSubmittedTemplate(updatedOnboarding.candidateName);

        const to = "arsdeen50@gmail.com"; 

        await sendMail(
          to,
          `Candidate Documents Submitted - ${updatedOnboarding.candidateName}`,
          htmlContent
        );

        console.log(`Documents Submitted email sent to ${to}`);
      } catch (mailError) {
        console.error("Email sending failed (Documents Submitted):", mailError);
      }
    }
  
      if (prevStatus !== "In Progress" && newStatus === "In Progress") {
        try {
          const htmlContent = onboardingTemplate(updatedOnboarding.candidateName);
  
          const to = updatedOnboarding.email;
          const cc = ["arsdeen50@gmail.com"];
          const bcc = ["sayedfardeen815@gmail.com", "shaikhfazil180@gmail.com"];
  
          await sendMail(
            to,
            `Onboarding In Progress - ${updatedOnboarding.candidateName}`,
            htmlContent,
            cc,
            bcc
          );
  
          console.log(`In Progress email sent to ${updatedOnboarding.email}`);
        } catch (mailError) {
          console.error("Email sending failed (In Progress):", mailError);
        }
      }

       // === When status changes to "Approved" ===
    if (prevStatus !== "Approved" && newStatus === "Approved") {
        try {
          const pdfData = await generateAndUploadPDF(updatedOnboarding);
  
          await GoOnBoarding.findByIdAndUpdate(id, {
            internshipOfferPdf: {
              fileName: `${updatedOnboarding.positionType}_Offer_${updatedOnboarding.candidateName}.pdf`,
              fileUrl: pdfData.url,
            },
          });
  
          const attachments = [
            {
              filename: `${updatedOnboarding.positionType}_Offer_${updatedOnboarding.candidateName}.pdf`,
              content: pdfData.buffer,
              contentType: "application/pdf",
            },
          ];
  
          const htmlContent = onboardingApprovedTemplate(updatedOnboarding.candidateName, updatedOnboarding.positionType);
  
          const to = updatedOnboarding.email;
          const cc = ["arsdeen50@gmail.com"];
          const bcc = ["sayedfardeen815@gmail.com", "shaikhfazil180@gmail.com"];
  
          await sendMail(
            to,
            `Onboarding Approved - ${updatedOnboarding.candidateName}`,
            htmlContent,
            cc,
            bcc,
            attachments
          );
  
          console.log(`Approved email sent to ${updatedOnboarding.email}`);
        } catch (mailError) {
          console.error("Email sending failed (Approved):", mailError);
        }
      }
  
      res.status(200).json({
        success: true,
        message: "Onboarding updated successfully",
        onboarding: updatedOnboarding,
      });
  
    } catch (err) {
      console.error("Error updating onboarding:", err);
  
      if (err.name === "ValidationError") {
        const errors = Object.values(err.errors).map((error) => error.message);
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors,
        });
      }
  
      res.status(500).json({
        success: false,
        message: err.message || "Server error",
      });
    }
  };
  

/* ---------------------- Delete GoOnBoarding ---------------------- */
export const deleteGoOnBoarding = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding ID",
      });
    }

    const deletedOnboarding = await GoOnBoarding.findByIdAndDelete(id);

    if (!deletedOnboarding) {
      return res.status(404).json({
        success: false,
        message: "Onboarding record not found",
      });
    }

    // Optionally delete files from cloudinary
    // You can implement this if needed

    res.status(200).json({
      success: true,
      message: "Onboarding deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting onboarding:", err);
    res.status(500).json({
      success: false,
      message: "Server error while deleting onboarding",
    });
  }
};

/* ---------------------- Get Onboarding Statistics ---------------------- */
export const getOnboardingStats = async (req, res) => {
  try {
    const stats = await GoOnBoarding.aggregate([
      {
        $group: {
          _id: "$candidateStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalCount = await GoOnBoarding.countDocuments();

    // Format stats
    const statusStats = {};
    stats.forEach((stat) => {
      statusStats[stat._id] = stat.count;
    });

    res.status(200).json({
      success: true,
      stats: {
        total: totalCount,
        byStatus: statusStats,
      },
    });
  } catch (err) {
    console.error("Error fetching onboarding stats:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching statistics",
    });
  }
};

/* ---------------------- Delete Specific Document ---------------------- */
export const deleteOnboardingDocument = async (req, res) => {
  try {
    const { id, docType, docIndex } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding ID",
      });
    }

    const onboarding = await GoOnBoarding.findById(id);
    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "Onboarding record not found",
      });
    }

    // Handle array fields (like lastThreeMonthSalary)
    if (docType === "lastThreeMonthSalary") {
      if (
        onboarding.lastThreeMonthSalary &&
        onboarding.lastThreeMonthSalary[docIndex]
      ) {
        onboarding.lastThreeMonthSalary.splice(docIndex, 1);
        await onboarding.save();
      }
    }
    // Handle single file fields
    else if (
      [
        "uploadProfile",
        "aadharFront",
        "aadharBack",
        "resume",
        "chequePassBookImage",
        "educationCertificateImage",
        "previousEmployeImage",
      ].includes(docType)
    ) {
      onboarding[docType] = undefined;
      await onboarding.save();
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid document type",
      });
    }

    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      onboarding: onboarding,
    });
  } catch (err) {
    console.error("Error deleting document:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};


/* ---------------------- Preview Offer Letter ---------------------- */
export const previewOfferLetter = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding ID",
      });
    }

    const onboarding = await GoOnBoarding.findById(id).select("-__v");

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "Onboarding record not found",
      });
    }

    // Generate PDF without uploading to Cloudinary
    const pdfData = await generateAndUploadPDF(onboarding, true); // Pass true for preview mode

    // Return PDF as base64 for preview
    res.status(200).json({
      success: true,
      message: "Offer letter generated successfully",
      pdfData: {
        base64: pdfData.buffer.toString('base64'),
        fileName: `${onboarding.positionType}_Offer_${onboarding.candidateName}_Preview.pdf`
      }
    });

  } catch (err) {
    console.error("Error generating offer letter preview:", err);
    res.status(500).json({
      success: false,
      message: "Server error while generating offer letter preview",
    });
  }
};