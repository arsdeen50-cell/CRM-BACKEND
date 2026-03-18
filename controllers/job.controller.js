import { Job } from "../models/job.model.js";
import { User } from "../models/user.model.js";

export const postJob = async (req, res) => {
  try {
    const {
      title,
      description,
      requirements,
      salary,
      location,
      jobType,
      experienceLevel,
      position,
      companyId,
    } = req.body;
    const userId = req.id;

    if (
      !title ||
      !description ||
      !requirements ||
      !salary ||
      !location ||
      !jobType ||
      !experienceLevel ||
      !position ||
      !companyId
    ) {
      return res.status(400).json({
        message: "Something is missing.",
        success: false,
      });
    }

    // Fetch user details
    const user = await User.findById(userId).select("fullname email");
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
        success: false,
      });
    }

    const job = await Job.create({
      title,
      description,
      requirements: Array.isArray(requirements)
        ? requirements
        : requirements.split(","),
      salary: Number(salary),
      location,
      jobType,
      experienceLevel,
      position,
      company: companyId,
      created_by: {
        _id: userId,
        fullname: user.fullname,
        email: user.email,
      },
    });

    return res.status(200).json({
      message: "New Job created Successfully",
      job,
      success: true,
    });
  } catch (error) {
    console.log("Error posting job:", error);
  }
};

export const getAllJobs = async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
    const query = {
      $or: [
        { title: { $regex: keyword, $options: "i" } },
        { description: { $regex: keyword, $options: "i" } },
      ],
    };

    const jobs = await Job.find(query)
      .populate({
        path: "company",
      })
      .populate({
        path: "created_by",
        select: "fullname email phoneNumber role",
      })
      .sort({ createdAt: -1 });

    if (!jobs || jobs.length === 0) {
      return res.status(404).json({
        message: "No jobs found.",
        success: false,
      });
    }

    return res.status(200).json({
      jobs,
      success: true,
    });
  } catch (error) {
    console.log("Error fetching jobs:", error);
    res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const getJobById = async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await Job.findById(jobId)
      .populate({
        path: "application",
      })
      .populate({
        path: "company",
      })
      .populate({
        path: "created_by",
        select: "fullname email phoneNumber role",
      });

    if (!job) {
      return res.status(404).json({
        message: "Job not found.",
        success: false,
      });
    }

    return res.status(200).json({ job, success: true });
  } catch (error) {
    console.log(error);
  }
};

export const getAdminJobs = async (req, res) => {
  try {
    const adminId = req.id;

    console.log("Admin ID:", adminId); // ✅ Check if adminId is correct

    const jobs = await Job.find({ created_by: adminId })
      .populate({
        path: "company",
      })
      .populate({
        path: "created_by",
        select: "fullname email phoneNumber role",
      });

    console.log("Jobs Found:", jobs); // ✅ Check if jobs are retrieved

    if (!jobs || jobs.length === 0) {
      return res.status(404).json({
        message: "Job not found.",
        success: false,
      });
    }

    return res.status(200).json({
      jobs,
      success: true,
    });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ message: "Server Error", success: false });
  }
};

export const updateJob = async (req, res) => {
  try {
    const { id } = req.params; // Job ID from URL params
    const {
      title,
      description,
      requirements,
      salary,
      location,
      jobType,
      experienceLevel,
      position,
      companyId,
    } = req.body; // Data to be updated
    const userId = req.id; // Logged in user ID from authentication

    const job = await Job.findById(id); // Find the job by its ID

    if (!job) {
      return res.status(404).json({
        message: "Job not found.",
        success: false,
      });
    }

    // Check if the user is allowed to update the job (either as admin or the creator)
    if (job.created_by.toString() !== userId) {
      return res.status(403).json({
        message: "You are not authorized to update this job.",
        success: false,
      });
    }

    // Update job fields only if they are provided in the request
    job.title = title || job.title;
    job.description = description || job.description;
    job.requirements =
      requirements && Array.isArray(requirements)
        ? requirements
        : (requirements && requirements.split(",")) || job.requirements;
    job.salary = salary || job.salary;
    job.location = location || job.location;
    job.jobType = jobType || job.jobType;
    job.experienceLevel = experienceLevel || job.experienceLevel;
    job.position = position || job.position;
    job.company = companyId || job.company;

    await job.save(); // Save updated job to the database

    return res.status(200).json({
      message: "Job updated successfully.",
      job,
      success: true,
    });
  } catch (error) {
    console.log("Error updating job:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const deleteJob = async (req, res) => {
  try {
    const { id } = req.params; // Job ID from URL params
    const userId = req.id; // Logged in user ID from authentication

    const job = await Job.findById(id); // Find the job by its ID

    if (!job) {
      return res.status(404).json({
        message: "Job not found.",
        success: false,
      });
    }

    // Check if the user is allowed to delete the job (either as admin or the creator)
    if (job.created_by.toString() !== userId) {
      return res.status(403).json({
        message: "You are not authorized to delete this job.",
        success: false,
      });
    }

    // Instead of job.remove(), use deleteOne or findByIdAndDelete
    await Job.findByIdAndDelete(id); // Delete the job from the database

    return res.status(200).json({
      message: "Job deleted successfully.",
      success: true,
    });
  } catch (error) {
    console.log("Error deleting job:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};
