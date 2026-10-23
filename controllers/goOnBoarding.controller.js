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
import { User } from "../models/user.model.js";
import bcrypt from "bcryptjs";

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

    // Check if candidate already exists
    const existingCandidate = await GoOnBoarding.findOne({
      $or: [
        { email: onboardingData.email },

      ]
    });

    if (existingCandidate) {
      return res.status(400).json({
        success: false,
        message: "Candidate with this email or mobile number already exists",
      });
    }

    // Handle signupCredentials from formData
    if (onboardingData.signupCredentials) {
      try {
        // If signupCredentials is a string (JSON), parse it
        if (typeof onboardingData.signupCredentials === 'string') {
          onboardingData.signupCredentials = JSON.parse(onboardingData.signupCredentials);
        }
      } catch (e) {
        console.error("Error parsing signupCredentials:", e);
      }
    } else {
      // Fallback: check for individual signup fields
      if (onboardingData.signupFullname) {
        onboardingData.signupCredentials = {
          fullname: onboardingData.signupFullname,
          email: onboardingData.signupEmail || onboardingData.email,
          phoneNumber: onboardingData.signupPhone || onboardingData.mobileNo,
          password: onboardingData.signupPassword || "Temp@123",
          role: 'employee',
          createdAt: new Date(),
        };
      }
    }

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

            // Check if user already exists with this email
        const existingUser = await User.findOne({ email: updatedOnboarding.email });
        
        let userCreated = false;
        let empId = null;
        let generatedPassword = null;
        
        if (existingUser) {
            console.log(`User already exists with email: ${updatedOnboarding.email}`);
            // Don't create user, don't send email
            userCreated = false;
            
            // Return error response with specific message
            return res.status(400).json({
                success: false,
                message: `Cannot approve: User with email ${updatedOnboarding.email} already exists in the system. Please use a different email address.`,
                error: "DUPLICATE_EMAIL",
                email: updatedOnboarding.email
            });
        } else {
            // Generate empId and password only if user doesn't exist
            const userCount = await User.countDocuments();
            empId = `EMP-${String(userCount + 1).padStart(3, "0")}`;
            
            // Generate password: TOM@ + empId (e.g., TOM@EMP-001)
            generatedPassword = `TOM@${empId}`;
            const hashedPassword = await bcrypt.hash(generatedPassword, 10);
            
            // Create user data
            const userData = {
                fullname: updatedOnboarding.candidateName,
                email: updatedOnboarding.email,
                phoneNumber: updatedOnboarding.mobileNo,
                password: hashedPassword,
                empId: empId,
            };
            
            // Handle profile photo if exists
            if (updatedOnboarding.uploadProfile && updatedOnboarding.uploadProfile.fileUrl) {
                userData.profile = {
                    profilePhoto: updatedOnboarding.uploadProfile.fileUrl,
                };
            }
            
            // Create user in database
            await User.create(userData);
            userCreated = true;
            
            console.log(`User created successfully with email: ${updatedOnboarding.email}, empId: ${empId}, password: ${generatedPassword}`);
          }


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
  
          const htmlContent = onboardingApprovedTemplate(updatedOnboarding.candidateName, 
            updatedOnboarding.positionType,
            updatedOnboarding.email,
            generatedPassword,
            empId
          );
  
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
// controllers/goOnBoarding.controller.js - Fixed version

/* ---------------------- Create Onboarding From Signup ---------------------- */
export const createOnboardingFromSignup = async (req, res) => {
  try {
    const { candidateName, email, mobileNo, signupPassword, doj, ...rest } = req.body;

    console.log("Received signup data:", { candidateName, email, mobileNo });

    // Validate required fields
    if (!candidateName || !email || !mobileNo) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, and phone number are required",
      });
    }

    // Check if candidate already exists with same email or mobile
    const existingCandidate = await GoOnBoarding.findOne({
      $or: [
        { email: email },
      ]
    });

    if (existingCandidate) {
      return res.status(400).json({
        success: false,
        message: "User with this email or phone number already exists",
      });
    }

    // Handle profile image upload
    let uploadProfile = null;
    if (req.files && req.files.length > 0) {
      const profileFile = req.files.find((f) => f.fieldname === "uploadProfile");
      if (profileFile) {
        try {
          const fileuri = getDataUri(profileFile);
          const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
            resource_type: "auto",
            folder: "onboarding_documents",
          });
          uploadProfile = {
            fileName: profileFile.originalname,
            fileUrl: cloudResponse.secure_url,
          };
        } catch (uploadError) {
          console.error("Profile upload error:", uploadError);
          // Continue without profile if upload fails
        }
      }
    }

    // Create onboarding with signup data
    const onboardingData = {
      candidateName: candidateName.trim(),
      email: email.trim().toLowerCase(),
      mobileNo: mobileNo.trim(),
      doj: doj || new Date().toISOString().split('T')[0],
      uploadProfile: uploadProfile,
      signupCredentials: {
        fullname: candidateName.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: mobileNo.trim(),
        password: signupPassword, // Store for later use
        file: uploadProfile,
        role: 'employee',
        createdAt: new Date(),
      },
      candidateStatus: 'Pending',
      candidateFormSubmitted: false,
    };

    console.log("Creating onboarding with data:", onboardingData);

    const newOnboarding = new GoOnBoarding(onboardingData);
    await newOnboarding.save();

    res.status(201).json({
      success: true,
      message: "Signup completed! Please complete your onboarding details.",
      onboarding: {
        _id: newOnboarding._id,
        candidateName: newOnboarding.candidateName,
        email: newOnboarding.email,
      },
    });
  } catch (err) {
    console.error("Error creating onboarding from signup:", err);
    
    // Handle validation errors
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((error) => error.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: errors,
      });
    }

    // Handle duplicate key error
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "User with this email or phone number already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Server error while creating onboarding from signup",
    });
  }
};
/* ---------------- Candidate self-service (no login) ----------------
   The candidate's emailed link only ever sees a safe summary of their own record, and can submit
   their part of the form once, while HR has the form open ("Send Link To Candidate"). */
const CANDIDATE_FIELDS = ["uanNo", "esic", "bankName", "bankAccountNo", "branchName", "IfcCode", "emergencyContactName", "emergencyContactNo"];
const CANDIDATE_FILES = ["chequePassBookImage", "educationCertificateImage", "previousEmployeImage"];

export const getCandidateView = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "Form not found" });
    const o = await GoOnBoarding.findById(req.params.id).select("candidateName email mobileNo designation doj positionType keyResponsibilities whatYoullGain candidateFormSubmitted candidateStatus").lean();
    if (!o) return res.status(404).json({ success: false, message: "Form not found" });
    res.json({ success: true, onboarding: o });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const submitCandidateForm = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "Form not found" });
    const o = await GoOnBoarding.findById(req.params.id).select("candidateFormSubmitted candidateStatus").lean();
    if (!o) return res.status(404).json({ success: false, message: "Form not found" });
    if (o.candidateFormSubmitted) return res.status(400).json({ success: false, message: "This form has already been submitted" });
    if (o.candidateStatus !== "Send Link To Candidate") return res.status(400).json({ success: false, message: "This form isn't open for submission. Please contact HR." });
    // Only the candidate's own fields and documents; everything else is set by HR
    req.body = {
      ...Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => CANDIDATE_FIELDS.includes(k))),
      candidateFormSubmitted: true,
      candidateFormSubmittedAt: new Date().toISOString(),
      candidateStatus: "Documents Submitted",
    };
    req.files = (req.files || []).filter((f) => CANDIDATE_FILES.includes(f.fieldname));
    return updateGoOnBoarding(req, res, next);
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /onboarding/check-duplicate { candidateName, email, mobileNo } - used by the public signup form
export const checkDuplicateOnboarding = async (req, res) => {
  const { email = "", mobileNo = "" } = req.body || {};
  const or = [];
  if (String(email).trim()) or.push({ email: new RegExp(`^${String(email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (String(mobileNo).trim()) or.push({ mobileNo: String(mobileNo).trim() });
  const duplicate = or.length ? !!(await GoOnBoarding.exists({ $or: or })) : false;
  res.json({ success: true, duplicate });
};
