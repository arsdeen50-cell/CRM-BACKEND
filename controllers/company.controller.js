import { Company } from "../models/company.model.js";
import cloudinary from "../utils/cloudinary.js";
import getDataUri from "../utils/datauri.js";

export const registerCompany = async (req, res) => {
  try {
    const { companyName } = req.body;
    if (!companyName) {
      return res.status(400).json({
        message: "company name is required",
        success: false,
      });
    }

    let company = await Company.findOne({ name: companyName });

    if (company) {
      return res.status(400).json({
        message: " You cannot register with same company name.",
        success: false,
      });
    }

    company = await Company.create({
      name: companyName,
      userId: req.id,
    });

    return res.status(200).json({
      message: " Company register Succesfully.",
      company,
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

export const getCompany = async (req, res) => {
  try {
    const userId = req.id; // logged in user id
    const companies = await Company.find({ userId }).populate(
      "userId",
      "fullname email"
    );

    if (!companies || companies.length === 0) {
      return res.status(404).json({
        message: "No company found for this user.",
        success: false,
      });
    }
    return res.status(200).json({
      message: "Companies fetched successfully.",
      companies,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching companies:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

// get company by id

export const getCompanyById = async (req, res) => {
  try {
    const companyId = req.params.id;
    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        message: " Company not found.",
        success: false,
      });
    }

    return res.status(200).json({
      company,
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

export const updateCompany = async (req, res) => {
  try {
    const { name, description, website, location } = req.body;

    const file = req.file;
    const fileuri = getDataUri(file);
    const cloudResponse = await cloudinary.uploader.upload(fileuri.content);

    const logo = cloudResponse.secure_url;

    const updateData = {
      name,
      description,
      website,
      location,
      logo,
    };

    const company = await Company.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

    if (!company) {
      return res.status(404).json({
        message: " Company not found.",
        success: false,
      });
    }

    return res.status(200).json({
      message: "Company infomation updated.",
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};
