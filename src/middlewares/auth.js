const jwt= require("jsonwebtoken");

//Middleware to verify token.

const authenticateToken =(req,res,next)=>{
    const authHeader = req.headers["authorization"];
    const token= authHeader && authHeader.split(" ")[1];
    if(!token){
        return  res.status(401).json({message : "Access token required"}); 
    }
    jwt.verify(token,process.env.JWT_SECRET,(err,user)=>{
        if(err) return res.status(403).json({message: "Invalid or expired token"});
        req.user=user;
        next();
    });
};

// Middleware for role-based authorization
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient permissions" });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRoles };