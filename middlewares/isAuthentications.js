import jwt from "jsonwebtoken";

const isAuthenticated = async (req, res, next) => {
  try {
    // Check for token in:
    // 1. Cookies (if using cookies)
    // 2. Authorization header
    // 3. Or other locations where you might store it
    
    let token;
    
    // Option 1: Check cookies first
    if (req.cookies.token) {
      token = req.cookies.token;
    } 
    // Option 2: Check Authorization header
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Option 3: Check body or query (less secure)
    else if (req.body.token) {
      token = req.body.token;
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        message: "Please login to access this resource",
        success: false,
      });
    }

    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    req.user = decoded; // Attach the decoded user to the request
     req.id = decoded.userId; 
     req.role = decoded.role;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      message: "Internal server error",
      success: false,
    })
    };
  }


export default isAuthenticated;