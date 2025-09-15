const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const app = express();
app.use(cookieParser());

app.use(express.json());

// Configure allowed origins via env var FRONTEND_ORIGIN (comma-separated). Defaults to localhost dev origin.
const frontendOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (frontendOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('CORS policy: This origin is not allowed: ' + origin));
  },
  credentials: true
}));

// Optionally allow the front-end to preflight any route
app.options('*', cors());


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
