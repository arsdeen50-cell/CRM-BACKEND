export const isAdmin = (req, res, next) => {
  if (req.role !== "admin") {
    return res.status(403).json({ message: "Access denied. Admins only.", success: false });
  }
  next();
};
