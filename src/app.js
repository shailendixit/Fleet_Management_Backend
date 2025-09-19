const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const app = express();
app.use(cookieParser());

app.use(express.json());



const allowedOrigins = [
  "http://localhost:8081",
  process.env.FRONTEND_URL,
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
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
