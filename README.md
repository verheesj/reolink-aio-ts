# 🎥 Reolink AIO TypeScript

<div align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
![Status: Pre-release](https://img.shields.io/badge/status-pre--release-orange.svg)

**A modern, fully-typed TypeScript library for controlling Reolink cameras and NVRs**

This project implements Reolink’s private Baichuan API — the same API used by the official Reolink iOS/Android apps and the Reolink CLI. The implementation is informed by and based on the excellent Python project [reolink-aio](https://github.com/starkillerOG/reolink_aio).

[Features](#-features) • [Installation](#-installation) • [Quick Start](#-quick-start) • [Examples](#-examples) • [API](#-api-reference) • [TODO](#-todo--roadmap)

</div>

---

## ✨ Features

### 🎯 Core Functionality

- ✅ **Full TypeScript Support** - Complete type safety and IntelliSense
- ✅ **HTTP API Client** - Comprehensive REST API implementation
- ✅ **Baichuan API/Protocol** - Implements Reolink’s Baichuan API (same as official apps/CLI); real-time push events via TCP
- ✅ **NVR & Camera Support** - Works with both standalone cameras and NVR systems
- ✅ **VOD (Video on Demand)** - Search, browse, and download recorded clips
- ✅ **Session Management** - Automatic token refresh and connection handling
- ✅ **Error Handling** - Rich exception hierarchy for robust error management

### 🔔 Real-Time Events

- ✅ **Motion Detection** - Real-time motion alerts via Baichuan
- ✅ **AI Detection** - Person, vehicle, pet/animal, face, and package detection
- ✅ **Visitor Detection** - Doorbell button press events
- ✅ **State Monitoring** - Continuous monitoring of camera states
- ✅ **Event Subscription** - Subscribe to push notifications

### 📹 Video & Media

- ✅ **VOD File Search** - Find recordings by time range and event type
- ✅ **Video Download** - Download MP4 clips from NVR/cameras
- ✅ **Multiple Streams** - Support for main and sub streams
- ✅ **Stream URLs** - Generate FLV, RTMP, and RTSP URLs
- 🔧 **Snapshot Capture** - Get still images from cameras *(planned)*

### 🎛️ Device Control

- ✅ **IR Lights** - Control infrared illumination
- ✅ **Spotlight** - Toggle camera spotlight with brightness control
- ✅ **Siren** - Activate camera siren/audio alarm (fully working!)
- ✅ **Focus Control** - Set camera focus position
- ✅ **Zoom Control** - Set camera zoom position
- ✅ **PTZ Control** - Pan/Tilt/Zoom operations with presets, patrols, guard positions, and auto-tracking

### 📊 Device Information

- ✅ **Device Discovery** - Automatic NVR/camera detection
- ✅ **Channel Management** - Multi-channel support for NVRs
- ✅ **Capability Detection** - Automatic feature detection
- ✅ **Model Information** - Device model, firmware, hardware version
- ✅ **Network Settings** - Port configuration (RTSP, RTMP, ONVIF)

---

## 📦 Installation

```bash
npm install reolink-aio@next
```

Note: This package is currently a pre-release. Interfaces and behavior may change between versions. For stability, pin an exact version or wait for a 1.0.0 stable release.

---

## 🚀 Quick Start

### Basic Connection

```typescript
import { Host } from 'reolink-aio';

const host = new Host('192.168.1.100', 'admin', 'your-password');

// Connect and fetch device information
await host.getHostData();

console.log(`Connected to: ${host.nvrName}`);
console.log(`Channels: ${host.channelsValue.length}`);
```

### Device Control

```typescript
import { Host } from 'reolink-aio';

const host = new Host('192.168.1.100', 'admin', 'your-password');
await host.getHostData();

// Control IR lights (Auto mode enables IR, Off disables it)
await host.setIrLights(0, true);  // Enable IR lights
await host.setIrLights(0, false); // Disable IR lights

// Control spotlight/floodlight
await host.setSpotlight(0, true);      // Turn on at current brightness
await host.setSpotlight(0, true, 75);  // Turn on at 75% brightness
await host.setSpotlight(0, false);     // Turn off

// Control siren/audio alarm
await host.setSiren(0, true, 2);    // Sound siren for 2 seconds
await host.setSiren(0, false);      // Stop siren immediately

// Control zoom and focus (for cameras that support it)
await host.setZoom(0, 16);   // Set zoom position (0-33 typically)
await host.setFocus(0, 128); // Set focus position (0-255 typically)

// PTZ control (for cameras with Pan/Tilt/Zoom)
await host.ptzControl(0, 'Left', undefined, 32);  // Move left at speed 32
await host.gotoPreset(0, 'Home');                  // Go to preset position
await host.startPatrol(0);                         // Start auto patrol
await host.setPtzGuard(0, 'set');                  // Set current position as guard
await host.setAutoTracking(0, true);               // Enable auto-tracking
```

### Real-Time Motion Detection

```typescript
import { Host } from 'reolink-aio';

const host = new Host('192.168.1.100', 'admin', 'your-password');
await host.getHostData();

// Subscribe to events
await host.baichuan.subscribeEvents();

// Monitor motion states
setInterval(async () => {
  await host.getStates();
  
  for (const channel of host.channelsValue) {
    if (host.motionDetected(channel)) {
      console.log(`⚠️  Motion on ${host.cameraName(channel)}!`);
    }
    
    if (host.aiDetected(channel, 'person')) {
      console.log(`👤 Person detected!`);
    }
  }
}, 2000);
```

### Download Video Clips

```typescript
import { Host } from 'reolink-aio';
import * as fs from 'fs';

const host = new Host('192.168.1.100', 'admin', 'your-password');
await host.getHostData();

// Search for recordings
const startTime = new Date(Date.now() - 3600000); // 1 hour ago
const endTime = new Date();

const clips = await host.requestVodFiles(0, startTime, endTime, true);

// Download the first clip
if (clips.length > 0) {
  const result = await host.downloadVod(
    0,
    clips[0].startTime,
    clips[0].endTime,
    'sub'
  );
  
  fs.writeFileSync('recording.mp4', new Uint8Array(result.data));
  console.log(`Downloaded: ${(result.data.byteLength / 1024 / 1024).toFixed(2)} MB`);
}
```

---

## 📚 Examples

The `examples/` directory contains complete, working examples:

| Example | Description | Difficulty |
|---------|-------------|------------|
| [01-basic-connection.ts](examples/01-basic-connection.ts) | Connect to camera and display info | 🟢 Beginner |
| [02-get-video-clips.ts](examples/02-get-video-clips.ts) | Search and list VOD recordings | 🟢 Beginner |
| [03-motion-monitor.ts](examples/03-motion-monitor.ts) | Real-time motion/AI detection | 🟡 Intermediate |
| [04-download-clips.ts](examples/04-download-clips.ts) | Download MP4 clips from NVR | 🟡 Intermediate |
| [05-event-webhook.ts](examples/05-event-webhook.ts) | Webhook event receiver | 🔴 Advanced |
| [06-scheduled-backup.ts](examples/06-scheduled-backup.ts) | Automated backup system | 🔴 Advanced |
| [07-device-control.ts](examples/07-device-control.ts) | Control IR, spotlight, siren, zoom | 🟢 Beginner |
| [08-ptz-control.ts](examples/08-ptz-control.ts) | PTZ movement, presets, patrols, tracking | 🟡 Intermediate |

### Running Examples

```bash
# Update credentials in the example file first
npx tsx examples/01-basic-connection.ts

# Enable debug logging
REOLINK_AIO_DEBUG=1 npx tsx examples/03-motion-monitor.ts
```

---

## 🔌 API Reference

### Host Class

The main class for interacting with Reolink devices.

#### Constructor

```typescript
new Host(
  host: string,           // IP address or hostname
  username: string,       // Username
  password: string,       // Password
  port?: number,          // HTTP port (default: 80 or 443)
  useHttps?: boolean,     // Use HTTPS (default: auto-detect)
  protocol?: string,      // Stream protocol (default: 'rtmp')
  stream?: string,        // Stream quality (default: 'sub')
  timeout?: number        // Request timeout in seconds (default: 60)
)
```

#### Core Methods

- `getHostData()` - Fetch and cache device information
- `getStates()` - Update current states (motion, AI detection, etc.)
- `login()` - Manually login (usually automatic)
- `logout()` - Logout and end session

#### State Detection

- `motionDetected(channel)` - Check if motion detected
- `aiDetected(channel, objectType)` - Check AI detection
  - Supported types: `'person'`, `'vehicle'`, `'dog_cat'`, `'face'`, `'package'`
- `visitorDetected(channel)` - Check if doorbell pressed
- `irEnabled(channel)` - Check if IR lights enabled

#### Control Methods

- `setIrLights(channel, enabled)` - Control IR illumination
- `setSpotlight(channel, enabled, brightness?)` - Control spotlight/floodlight
- `setSiren(channel, enabled, duration?)` - Activate siren/audio alarm
- `setFocus(channel, position)` - Set focus position (0-255)
- `setZoom(channel, position)` - Set zoom position (0-33 typically)

#### PTZ Methods

- `ptzControl(channel, command?, preset?, speed?, patrol?)` - Manual PTZ control
- `gotoPreset(channel, preset)` - Move to preset position
- `getPtzPresets(channel)` - Get available presets
- `getPtzPatrols(channel)` - Get available patrols
- `startPatrol(channel)` - Start auto patrol
- `stopPatrol(channel)` - Stop auto patrol
- `getPtzPanPosition(channel)` - Get current pan position
- `getPtzTiltPosition(channel)` - Get current tilt position
- `isPtzGuardEnabled(channel)` - Check if guard enabled
- `getPtzGuardTime(channel)` - Get guard return time
- `setPtzGuard(channel, command?, enable?, time?)` - Configure guard position
- `ptzCalibrate(channel)` - Calibrate PTZ
- `isAutoTrackingEnabled(channel)` - Check if auto-tracking enabled
- `setAutoTracking(channel, enable?, disappearTime?, stopTime?, method?)` - Configure auto-tracking
- `getAutoTrackMethod(channel)` - Get tracking method
- `getAutoTrackLimitLeft(channel)` - Get left limit
- `getAutoTrackLimitRight(channel)` - Get right limit
- `setAutoTrackLimit(channel, left?, right?)` - Set tracking limits

#### Device Information

- `nvrName` - Device name
- `isNvrValue` - Is NVR?
- `channelsValue` - Active channels
- `cameraName(channel)` - Get camera name
- `cameraModel(channel)` - Get camera model

---

## 📋 TODO & Roadmap

### High Priority

- [x] **Device Control Commands**
  - [x] `setIrLights()` - Control IR illumination
  - [x] `setSpotlight()` - Toggle spotlight
  - [x] `setSiren()` - Activate siren (fully working!)
  - [x] `setFocus()` - Focus control
  - [x] `setZoom()` - Digital zoom

- [x] **PTZ (Pan/Tilt/Zoom)**
  - [x] `ptzControl()` - Manual PTZ movement
  - [x] `getPtzPresets()` - List presets
  - [x] `gotoPreset()` - Move to preset
  - [x] `startPatrol()` / `stopPatrol()` - Auto patrol
  - [x] `setPtzGuard()` - Guard position control
  - [x] `setAutoTracking()` - Auto-tracking configuration
  - [x] Position getters and patrol management

- [ ] **Video Streaming**
  - [ ] Live stream helpers
  - [ ] Stream quality switching
  - [ ] Multi-stream support

### Medium Priority

- [ ] **Advanced Features**
  - [ ] `subscribe()` - Webhook subscriptions
  - [ ] `getSnapshot()` - Still images
  - [ ] Privacy mode detection
  - [ ] Audio support (two-way)
  - [ ] FTP configuration
  - [ ] Email notifications

- [ ] **Configuration Management**
  - [ ] Get/Set OSD settings
  - [ ] Get/Set recording schedules
  - [ ] Get/Set motion zones
  - [ ] Get/Set AI settings
  - [ ] Network configuration

### Low Priority

- [ ] **Optimization**
  - [ ] Connection pooling
  - [ ] Request batching
  - [ ] Caching layer

- [ ] **Testing**
  - [ ] Integration tests
  - [ ] Mock device server
  - [ ] Code coverage > 80%

- [ ] **Documentation**
  - [ ] API docs site
  - [ ] Video tutorials
  - [ ] Migration guide

### Completed ✅

- [x] Basic HTTP API client
- [x] Baichuan event protocol
- [x] Device information retrieval
- [x] Motion/AI detection monitoring
- [x] VOD file search and listing
- [x] VOD file download (NVR)
- [x] Stream URL generation
- [x] Session management
- [x] TypeScript types
- [x] Working examples
- [x] NVR detection
- [x] Multi-channel support
- [x] Device control commands (IR, spotlight, siren, focus, zoom)
- [x] PTZ control (movement, presets, patrols, guard, auto-tracking)
- [x] Baichuan TCP protocol fixes (XML formatting, future cleanup)

---

## 📄 License

MIT © [starkillerOG](https://github.com/starkillerOG)

---

## 🙏 Acknowledgments

- Based on the Python [reolink_aio](https://github.com/starkillerOG/reolink_aio) library
- Thanks to the Reolink developer community
