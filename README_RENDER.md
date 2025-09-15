Render deployment steps

This README explains how to deploy the backend (and options for hosting the automation) to Render.

Prerequisites
- A Render account (https://render.com). Free tier available for small services.
- Your repository (GitHub/GitLab) connected to Render.
- Environment variables set in Render (see list below).

Recommended architecture
- Deploy the backend as a Web Service (Node) on Render. The server will listen on $PORT.
- For IMAP automation (real-time) run the same service as a Background Worker or Worker Service:
  - Option 1 (single deployment): Run the entire app (server + automation) as a single Web Service. The server will accept HTTP requests and the automation will start on process start.
  - Option 2 (separate worker): Create a separate service that runs `node src/automation/emailautomation.js` (use a worker service in Render).

Environment variables (required)
- DATABASE_URL: PostgreSQL connection string
- JWT_SECRET: JWT signing secret
- GMAIL_USER: Gmail address for IMAP and alerts
- GMAIL_APP_PASSWORD: Gmail app password (or OAuth2 token)
- ALERT_EMAIL_FROM: From address for alerts (can be same as GMAIL_USER)
- ALERT_EMAIL_TO: Recipient for missing-invoice alerts (e.g., Satkaushik131@gmail.com)
- ALERT_EMAIL_SUBJECT: Subject for alerts
- PORT: (optional) Render provides PORT env automatically; app uses process.env.PORT
- NODE_ENV: set to 'production'

Render steps (single Web Service)
1. Push your repo to GitHub/GitLab.
2. In Render, create a new Web Service -> Connect your repo and pick the backend folder as root.
3. Build Command: `npm ci && npx prisma generate --schema=prisma/schema.prisma`
4. Start Command: `node src/server.js`
5. Set the environment variables in Render dashboard (Secrets).
6. Deploy. Render will build the Docker image and run the service.

Render steps (separate worker for automation)
1. Create the backend web service as above but set start command to `node src/server.js`.
2. Create a second service (Worker) in Render from the same repo. Choose the command: `node src/automation/emailautomation.js`.
3. Set the same environment variables for the worker.
4. Deploy both services.

Database and migrations
- Run Prisma migrations before or during deploy on the production DB:
  - Locally: `npx prisma migrate deploy --schema=prisma/schema.prisma`
  - Or include migration step in Render build (careful with credentials and timing).

Logging and monitoring
- Capture stdout/stderr logs in Render dashboard.
- Add health checks and a `GET /health` route if needed.

Notes & security
- Do NOT commit real secrets. Use Render dashboard to set environment variables.
- Consider switching to Gmail OAuth2 for higher security in production; app passwords work but have limitations.

If you want, I can add a `docker-compose.yml`, `pm2` config, and an example Render service setup file next.
