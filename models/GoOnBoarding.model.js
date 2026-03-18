import mongoose from 'mongoose';

const goOnBoardingSchema = new mongoose.Schema(
  {
    // Personal Information
    recruiterName: {
      type: String,
    },
    uploadProfile: {
      fileName: String,
      fileUrl: String,
    },
    candidateName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    fatherName: {
      type: String,
    },
    DOB: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
    },
    mobileNo: {
      type: String,
    },
    
    // Professional Information
    designation: {
      type: String,
      required: true,
    },
    doj: {
      type: Date,
      required: true,
    },
    doe: {
      type: Date, 
    },
    positionType: {
      type: String,
      enum: ['Full Time', 'Internship', 'Contract', 'Part Time'],
      default: 'Full Time',
    },
    keyResponsibilities: [{
      type: String,
    }],
    whatYoullGain: [{
      type: String,
    }],
    
    // Address Information
    currentAddress: {
      type: String,
    },
    permanentAddress: {
      type: String,
    },
    residingCity: {
      type: String,
    },
    residingState: {
      type: String,
    },
    pincode: {
      type: String,
    },
    
    // Documents
    aadharFront: {
      fileName: String,
      fileUrl: String,
    },
    aadharBack: {
      fileName: String,
      fileUrl: String,
    },
    resume: {
      fileName: String,
      fileUrl: String,
    },
    lastThreeMonthSalary: [{
      fileName: String,
      fileUrl: String,
    }],
    
    // Experience & CTC
    workExperience: {
      type: Number, // in years
    },
    previousTotalCtc: {
      type: Number,
    },
    offeredFixedCtc: {
      type: Number,
    },
    offeredVariableCtc: {
      type: Number,
    },
    offeredTotalCtc: {
      type: Number,
    },
    candidateStatus: {
      type: String,
      enum: ['Pending',"Send Link To Candidate","Documents Submitted", 'In Progress', 'Approved', 'Rejected'],
      default: 'Pending',
    },
    uanNo: String,
    esic: String,
    bankName: String,
    bankAccountNo: String,
    branchName: String,
    IfcCode: String,
    emergencyContactName: String,
    emergencyContactNo: String,
    chequePassBookImage: {
      fileName: String,
      fileUrl: String,
    },
    educationCertificateImage: [{
      fileName: String,
      fileUrl: String,
    }],
    previousEmployeImage: [{
      fileName: String,
      fileUrl: String,
    }],
    candidateFormSubmitted: {
      type: Boolean,
      default: false
    },
    candidateFormSubmittedAt: Date,
  },
  { timestamps: true }
);

export const GoOnBoarding = mongoose.model('GoOnBoarding', goOnBoardingSchema);