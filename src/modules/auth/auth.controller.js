const jwt= require("jsonwebtoken");
const bcrypt= require("bcryptjs");

const prisma = require('../../lib/prisma');

exports.signup= async(req,res)=>{
    const {username,email,password, role} = req.body;
    try{
        const hashedPassword= await bcrypt.hash(password,10);
        const user= await prisma.User_Db.create({
            data: {username,email,password: hashedPassword, role: role || 'admin'}
        });
        return res.status(201).json({message: "user created successfully", user});
    }catch(error){
        console.error(error);
        return res.status(500).json({message: "internal server error"});
    }
};

exports.login= async(req,res)=>{
    const {username,password}= req.body;
    try{
        const user=await prisma.User_Db.findUnique({where: {username}});
        if(!user){
            return res.status(404).json({message: "user not found"});
        }
        const isMatch= await bcrypt.compare(password,user.password);
        if(!isMatch){
            return res.status(401).json({message: "invalid credentials"});
        }

        //Generate JWT
        const token= jwt.sign({id: user.id, username: user.username, role: user.role},
            process.env.JWT_SECRET,
            {expiresIn: "10h"}
        )

        // Set cookie (httpOnly) so browser stores it automatically if you prefer cookies
        // Note: res.cookie requires Express; cookie-parser is only needed to read cookies from req.cookies.
        res.cookie('token', token, {
            secure: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 10 * 60 * 60 * 1000 // 10 hours in ms
        });

        return res.status(200).json({"message":"User logged in successfully","token":token});
    }catch(error){
        console.error(error);
        return res.status(500).json({message: "internal server error"});
    }
};

// New endpoint: verify token and return user details (without password)
exports.verifyToken = async (req, res) => {
    try {
        // Accept token from Authorization header, cookie, or body
        let token;
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        } else if (req.body && req.body.token) {
            token = req.body.token;
        }

        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await prisma.User_Db.findUnique({ where: { id: decoded.id } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // remove password before sending
        const { password, ...userSafe } = user;
        return res.status(200).json({ valid: true, user: userSafe });
    } catch (err) {
        console.error(err);
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// Logout: clear the token cookie
exports.logout = async (req, res) => {
    try {
        // Clear cookie named 'token'
        res.clearCookie('token');
        return res.status(200).json({ message: 'Logged out' });
    } catch (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};