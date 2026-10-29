# NexusChat

NexusChat is a full-stack real-time messaging application built with React, Vite, Express, MongoDB, and Socket.IO. It supports direct conversations and group chats, with message actions and a responsive chat interface.

> **Project status:** The application builds and the current backend test suite includes authentication rate-limit tests. A successful build or clean dependency audit does not, by itself, prove production readiness. Review the deployment checklist before launching publicly.

## Features

### Messaging

- Direct conversations and group chats
- Real-time messaging with Socket.IO
- Online status, typing indicators, and read-status updates
- Unread message counts
- Image sharing through Cloudinary
- Message reactions and contextual message actions
- Group message replies, forwarding, pinning, and editing
- Group creation, details, member search, and member management
- Message search and date separators
- Media viewer for shared images
- Per-conversation draft preservation and scroll restoration
- Pinned conversations in the sidebar
- Profile settings

Available actions depend on the message type and the user's permissions.

## Tech stack

| Area | Technologies |
|---|---|
| Frontend | React 19, Vite, React Router, Tailwind CSS, Axios, Socket.IO Client |
| Backend | Node.js, Express 5, Socket.IO |
| Database | MongoDB with Mongoose |
| Authentication | JSON Web Tokens (JWT), bcryptjs |
| Media uploads | Cloudinary, Multer |
| Testing / quality | Node.js test runner, ESLint |

## Repository layout

```text
NexusChat/
├── client/                 # React + Vite frontend
│   ├── src/
│   ├── .env.example
│   └── package.json
├── server/                 # Express API + Socket.IO server
│   ├── controllers/
│   ├── lib/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── .gitignore
└── README.md
```

## Requirements

- Node.js 20 or newer
- npm
- A MongoDB database (local or hosted)
- A Cloudinary account for image and profile-picture uploads

## Local development setup

### 1. Get the project

Clone the repository or open the project folder you already have. Run commands from the `NexusChat` root directory unless another directory is shown.

### 2. Configure the backend

Create a local environment file from the example:

**PowerShell**

```powershell
Copy-Item .\server\.env.example .\server\.env
```

Edit `server/.env` and set the required values:

```dotenv
PORT=5000
MYDATABASE=mongodb+srv://<username>:<password>@<cluster>/<database>
MY_JWT=replace-with-a-long-random-secret
CLIENT_URL=http://localhost:5173
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
JWT_EXPIRES_IN=7d
DB_CONNECT_TIMEOUT_MS=10000
```

Replace the sample values with your own. `MYDATABASE`, `MY_JWT`, and `CLIENT_URL` must be configured. Cloudinary credentials are required for media upload features. Never commit `server/.env` or share its secrets.

### 3. Configure the frontend

**PowerShell**

```powershell
Copy-Item .\client\.env.example .\client\.env
```

The local default is:

```dotenv
VITE_BACKEND_URL=http://localhost:5000
```

`VITE_` variables are bundled into the frontend and are public. **Never put passwords, JWT secrets, or Cloudinary API secrets in a `VITE_` variable.**

### 4. Install dependencies

Install each app separately and use the committed lockfiles for reproducible installs:

```powershell
cd .\server
npm ci
cd ..\client
npm ci
cd ..
```

### 5. Start the backend

In a terminal from the project root:

```powershell
cd .\server
npm run dev
```

The API defaults to `http://localhost:5000`.

Check the service status at:

```text
http://localhost:5000/api/status
```

The status response includes whether the MongoDB connection is currently connected.

### 6. Start the frontend

Open a second terminal:

```powershell
cd .\client
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

## Useful commands

Run these from the relevant directory.

### Frontend (`client/`)

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run lint` | Run ESLint |
| `npm run build` | Create the production frontend build in `dist/` |
| `npm run preview` | Preview the built frontend locally |
| `npm audit` | Audit all frontend dependencies |
| `npm audit --omit=dev` | Audit production dependencies |

### Backend (`server/`)

| Command | Purpose |
|---|---|
| `npm run dev` | Start the API with Node's watch mode |
| `npm start` | Start the API normally |
| `npm test` | Run the included Node.js test suite |
| `npm audit` | Audit all backend dependencies |
| `npm audit --omit=dev` | Audit production dependencies |

The backend test suite is currently small and does not replace end-to-end testing of conversations, uploads, groups, presence, and read receipts.

## API overview

| Prefix / route | Purpose |
|---|---|
| `GET /api/status` | Service and database status |
| `/api/auth` | Authentication and user-related routes |
| `/api/messages` | Direct message routes |
| `/api/groups` | Group chat routes |

Most application routes require an authenticated user. Refer to `server/routes/` for the complete route definitions and HTTP methods.

## Real-time behavior and deployment limits

- Socket.IO connections authenticate using the application JWT.
- Messages are persisted to MongoDB before they are emitted to recipient and sender user rooms.
- The client can refetch persisted messages after reconnecting or opening a conversation.
- **Presence is currently process-local.** Running multiple backend instances without a shared Socket.IO adapter and shared presence store can lead to inconsistent presence and room events.

## Deployment checklist

Before exposing NexusChat to the public:

1. **Use production secrets.** Set environment variables in the hosting platform. Use a strong unique JWT secret; never commit `.env` files.
2. **Configure origins correctly.** Set `CLIENT_URL` to the exact deployed frontend origin (or comma-separated list of allowed origins). Set `VITE_BACKEND_URL` to the public backend URL before building the frontend.
3. **Use HTTPS and WebSockets.** Configure the host and any reverse proxy/load balancer to allow secure WebSocket connections.
4. **Restrict database access.** Use a dedicated MongoDB user with the minimum required permissions, restrict network access where possible, and configure backups.
5. **Verify media uploads.** Configure Cloudinary and test upload-size limits, MIME/type handling, and failure paths.
6. **Review security and monitoring.** Confirm request and Socket.IO authentication, authorization for every message/group action, rate limiting, error logging, and health monitoring.
7. **Test the deployed app.** Use at least two accounts and test direct and group messages, reactions, edit/delete, images, typing status, read receipts, disconnect/reconnect behavior, and group membership permissions.
8. **Re-run checks after dependency changes.** Run the frontend lint/build and backend tests/audits after updating packages.
9. **Use staging first.** Verify the real database, media provider, environment variables, CORS, and WebSocket connection before public launch.

The project should not be considered production-ready solely because the build succeeds or `npm audit` reports zero vulnerabilities. Complete the checks above against the actual deployment environment.

## Environment variable reference

### Backend

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port; defaults to `5000` |
| `MYDATABASE` | Yes | MongoDB connection URI |
| `MY_JWT` | Yes | JWT signing secret |
| `CLIENT_URL` | Yes | Allowed frontend origin(s), comma-separated if needed |
| `CLOUDINARY_CLOUD_NAME` | For media | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | For media | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | For media | Cloudinary API secret |
| `JWT_EXPIRES_IN` | No | JWT lifetime; defaults to `7d` |
| `DB_CONNECT_TIMEOUT_MS` | No | MongoDB connection timeout; defaults to `10000` ms |

### Frontend

| Variable | Required | Description |
|---|---|---|
| `VITE_BACKEND_URL` | Yes | Backend base URL used by the browser |

## Contributing

1. Create a branch for your change.
2. Keep changes scoped and preserve existing functionality.
3. Run frontend lint/build and backend tests before opening a pull request.
4. Never commit credentials, `.env` files, `node_modules`, or build output.

## License

No project-specific open-source license is declared in this repository yet. Add a `LICENSE` file before distributing the project under an open-source license.
