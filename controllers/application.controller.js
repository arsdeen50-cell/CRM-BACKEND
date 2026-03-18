import { Application } from "../models/application.model.js";
import { Job } from "../models/job.model.js";

export const applyJob = async (req, res) => {
  try {
    const userId = req.id;
    const jobId = req.params.id;

    if (!jobId) {
      return res.status(400).json({
        message: "Job Id is required",
        success: false,
      });
    }

    // check if user already applied the job or not
    const existingApplication = await Application.findOne({
      job: jobId,
      application: userId,
    });

    if (existingApplication) {
      return res.status(400).json({
        message: "You have already applied for the job.",
        success: false,
      });
    }

    // check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        message: "Job not found",
        success: false,
      });
    }

    // create n new application
    const newApplication = await Application.create({
      job: jobId,
      applicant: userId,
    });

    job.application.push(newApplication._id);
    await job.save();
    return res.status(200).json({
      message: "Job applied succesfully..",
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

export const getAppliedJobs = async (req, res) => {
  try {
    const userId = req.id;
    const application = await Application.find({ applicant: userId })
      .sort({ createdAt: -1 })
      .populate({
        path: "job",
        options: { sort: { createdAt: -1 } },
        populate: {
          path: "company",
          options: { sort: { createdAt: -1 } },
        },
      });

    if (!application) {
      return res.status(404).json({
        message: "No application found",
        success: false,
      });
    }

    return res.status(200).json({
      application,
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

// admin will see how many user will apllied for the job.
export const getApplicants = async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await Job.findById(jobId)
      .populate({
        path: "application",
        options: { sort: { createdAt: -1 } },
        populate: { path: "applicant" },
      })
      .populate({ path: "company" });

    if (!job) {
      return res.status(404).json({
        message: "Job not found",
        success: false,
      });
    }

    return res.status(200).json({
      job,
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const applicationId = req.params.id;

    if (!status) {
      return res.status(400).json({
        message: "Status is required",
        success: false,
      });
    }

    //find application by applicant id

    const applicantion = await Application.findOne({ _id: applicationId });

    if (!applicantion) {
      return res.status(404).json({
        message: "Application not found.",
        success: false,
      });
    }

    applicantion.status = status.toLowerCase();
    await applicantion.save();

    return res.status(200).json({
      message: "Application updated succesfully.",
      applicantion,
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};
