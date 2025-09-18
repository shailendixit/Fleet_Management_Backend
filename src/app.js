const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const app = express();
app.use(cookieParser());

app.use(express.json());



app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN, // replace with your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"], // allowed methods
    credentials: true, // if you need to send cookies/auth headers
  })
);

const authRoutes= require('./modules/auth/auth.routes');
const taskRoutes = require('./modules/task_assignments/task.routes');
const gmailRoutes = require('./modules/gmail/gmail.routes');
const driverRoutes = require('./modules/driver/driver.routes');

//All API routes for authentication
app.use('/api/auth', authRoutes);

// All API routes for task uploads
app.use('/api/tasks', taskRoutes);

// Gmail Pub/Sub push endpoint
app.use('/api/gmail', gmailRoutes);

// Driver-specific endpoints (start/complete assignment)
app.use('/api/driver', driverRoutes);

app.get('/', (req, res) => {
  res.send('Welcome to the Task Assignment API');   
});

module.exports = app;
