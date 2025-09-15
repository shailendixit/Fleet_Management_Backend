const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const app = express();
app.use(cookieParser());

app.use(express.json());

app.use(cors({
  origin: 'http://localhost:5173', // your React dev origin
  credentials: true                // <--- allow cookies to be sent
}));


const authRoutes= require('./modules/auth/auth.routes');
const taskRoutes = require('./modules/task_assignments/task.routes');
const gmailRoutes = require('./modules/gmail/gmail.routes');

//All API routes for authentication
app.use('/api/auth', authRoutes);

// All API routes for task uploads
app.use('/api/tasks', taskRoutes);

// Gmail Pub/Sub push endpoint
app.use('/api/gmail', gmailRoutes);

app.get('/', (req, res) => {
  res.send('Welcome to the Task Assignment API');   
});

module.exports = app;
