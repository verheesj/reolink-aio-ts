# API Documentation

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Type Reference](#type-reference)

## Installation

```bash
npm install reolink-aio
```

## Quick Start

```typescript
import { Host } from 'reolink-aio';

// Create a connection
const host = new Host('192.168.1.100', 'admin', 'your_password');

// Initialize and get device info
await host.getHostData();

// Get device information
console.log(host.nvr_name);
console.log(host.swVersionValue);
console.log(host.channels); // Available channels

// Control device
await host.setIrLights(0, true); // Turn on IR lights
await host.setSpotlight(0, true); // Turn on spotlight
await host.setSiren(0, true, 5); // Activate siren for 5 seconds

// Get VOD clips
const startDate = new Date('2023-11-01');
const endDate = new Date('2023-11-15');
const files = await host.requestVodFiles(0, startDate, endDate);

// Download clip
await host.downloadVod(files[0], '/path/to/save.mp4');
```

## Core Concepts

### Host Class

The `Host` class is the main entry point for interacting with Reolink devices. It handles:

- **Authentication**: Automatic login and session management
- **HTTP API**: Device configuration and control via REST API
- **Baichuan Protocol**: TCP-based protocol for real-time control (siren, spotlight, etc.)
- **VOD Management**: Video-on-demand retrieval and downloads

### Initialization

Always call `getHostData()` after creating a Host instance:

```typescript
const host = new Host('192.168.1.100', 'admin', 'password');
await host.getHostData(); // Required before using most methods
```

This method:
1. Authenticates with the device
2. Retrieves device capabilities
3. Initializes Baichuan protocol
4. Loads channel information

### Channels

Reolink NVRs support multiple cameras (channels). Most methods accept a channel parameter:

```typescript
// Single camera (channel 0)
// Multiple channels on NVR
for (const channel of host.channels) {
  console.log(host.cameraName(channel));
}

## API Reference

### Constructor

```typescript
new Host(
  host: string,
  username: string,
  password: string,
  port?: number | null,
  useHttps?: boolean | null,
  protocol?: string,
  stream?: string,
  timeout?: number,
  rtmpAuthMethod?: string,
  bcPort?: number,
  bcOnly?: boolean
)
```

**Parameters:**
- `host`: IP address or hostname
- `username`: Authentication username
- `password`: Authentication password
- `port`: HTTP(S) port (default: 80 for HTTP, 443 for HTTPS)
- `useHttps`: Use HTTPS (default: false)
- `protocol`: Streaming protocol - 'rtmp', 'rtsp', 'flv' (default: 'rtmp')
- `stream`: Stream type - 'main' or 'sub' (default: 'main')
- `timeout`: Request timeout in seconds (default: 60)
- `rtmpAuthMethod`: RTMP authentication method (default: 'password')
- `bcPort`: Baichuan TCP port (default: 9000)
- `bcOnly`: Use only Baichuan protocol (default: false)

### Device Information

#### `getHostData(): Promise<void>`

Initializes connection and retrieves device information. **Must be called first.**

```typescript
await host.getHostData();
```

#### `cameraName(channel: number | null): string`

Get camera name for a channel.

```typescript
const name = host.cameraName(0); // "Front Door"
```

#### `cameraModel(channel: number | null): string`

Get camera model.

```typescript
const model = host.cameraModel(0); // "RLC-810A"
```

#### `cameraUid(channel: number | null): string`

Get camera unique identifier.

```typescript
const uid = host.cameraUid(0);
```

### Properties

- `nvr_name`: NVR/device name
- `swVersionValue`: Software/firmware version
- `hardwareVersion`: Hardware version
- `channels`: Array of available channel numbers
- `isNvrValue`: True if device is an NVR
- `isHubValue`: True if device is a hub
- `macAddressValue`: Device MAC address

### Device Control

#### `setIrLights(channel: number, enabled: boolean): Promise<void>`

Control IR (infrared) lights.

```typescript
await host.setIrLights(0, true);  // Turn on
await host.setIrLights(0, false); // Turn off
```

#### `setSpotlight(channel: number, enabled: boolean): Promise<void>`

Control spotlight/white LED.

```typescript
await host.setSpotlight(0, true);  // Turn on
await host.setSpotlight(0, false); // Turn off
```

#### `setSiren(channel: number | null, enabled: boolean, duration?: number | null, times?: number | null): Promise<void>`

Control siren/audio alarm.

**Important:** Requires `getHostData()` to be called first to initialize Baichuan protocol.

```typescript
// Turn on siren for 5 seconds
await host.setSiren(0, true, 5);

// Turn off siren
await host.setSiren(0, false);

// Play siren 3 times
await host.setSiren(0, true, null, 3);
```

**Parameters:**
- `channel`: Camera channel (null for NVR-level siren)
- `enabled`: Turn siren on/off
- `duration`: Duration in seconds (default: 2)
- `times`: Number of times to play (overrides duration)

#### `setFocus(channel: number, focusPos: number): Promise<void>`

Set manual focus position (0-255).

```typescript
await host.setFocus(0, 128); // Set to middle position
```

#### `setZoom(channel: number, zoomPos: number): Promise<void>`

Set zoom position (0-33).

```typescript
await host.setZoom(0, 16); // Zoom in halfway
```

### Video-on-Demand (VOD)

#### `requestVodFiles(channel: number, start: Date, end: Date, streamType?: string): Promise<VODFile[]>`

Request list of recorded video files.

```typescript
const startDate = new Date('2023-11-01T00:00:00Z');
const endDate = new Date('2023-11-15T23:59:59Z');
const files = await host.requestVodFiles(0, startDate, endDate);

for (const file of files) {
  console.log(file.fileName);
  console.log(file.startTime);
  console.log(file.duration);
  console.log(file.triggers); // VODTrigger bit flags
}
```

#### `downloadVod(vodFile: VODFile, outputPath: string): Promise<void>`

Download a VOD file to local disk.

```typescript
const files = await host.requestVodFiles(0, startDate, endDate);
await host.downloadVod(files[0], '/path/to/video.mp4');
```

#### `getVodSource(vodFile: VODFile, channel: number): Promise<string>`

Get streaming URL for a VOD file.

```typescript
const url = await host.getVodSource(vodFile, 0);
// Use with video player
```

### Motion & AI Detection

#### `motionDetected(channel: number): boolean`

Check if motion is currently detected.

```typescript
if (host.motionDetected(0)) {
  console.log('Motion detected on camera 0');
}
```

#### `aiDetected(channel: number, aiType: string): boolean`

Check if AI detection is active.

```typescript
const aiTypes = ['person', 'vehicle', 'dog_cat', 'face', 'package'];
for (const aiType of aiTypes) {
  if (host.aiDetected(0, aiType)) {
    console.log(`${aiType} detected`);
  }
}
```

#### `visitorDetected(channel: number): boolean`

Check if visitor (doorbell) event detected.

```typescript
if (host.visitorDetected(0)) {
  console.log('Visitor at door');
}
```

## Examples

### Example 1: Basic Connection

```typescript
import { Host } from 'reolink-aio-ts';

async function main() {
  const host = new Host('192.168.1.100', 'admin', 'password');
  await host.getHostData();
  
  console.log('Connected to:', host.nvr_name);
  console.log('Firmware:', host.swVersionValue);
  console.log('Channels:', host.channels);
}

main();
```

### Example 2: Motion Monitoring

```typescript
import { Host } from 'reolink-aio-ts';

async function monitorMotion() {
  const host = new Host('192.168.1.100', 'admin', 'password');
  await host.getHostData();
  
  // Poll for motion every 2 seconds
  setInterval(async () => {
    for (const channel of host.channels) {
      if (host.motionDetected(channel)) {
        console.log(`Motion on ${host.cameraName(channel)}`);
        
        // Activate siren
        await host.setSiren(channel, true, 3);
      }
      
      // Check AI detections
      if (host.aiDetected(channel, 'person')) {
        console.log(`Person detected on ${host.cameraName(channel)}`);
      }
    }
  }, 2000);
}

monitorMotion();
```

### Example 3: Download Recent Clips

```typescript
import { Host, VODTrigger } from 'reolink-aio-ts';

async function downloadRecentClips() {
  const host = new Host('192.168.1.100', 'admin', 'password');
  await host.getHostData();
  
  // Get clips from last 24 hours
  const endDate = new Date();
  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  for (const channel of host.channels) {
    const files = await host.requestVodFiles(channel, startDate, endDate);
    
    // Filter for person detection
    const personClips = files.filter(f => f.triggers & VODTrigger.PERSON);
    
    for (const clip of personClips) {
      const filename = `channel_${channel}_${clip.fileName}`;
      console.log(`Downloading ${filename}...`);
      await host.downloadVod(clip, `/downloads/${filename}`);
    }
  }
}

downloadRecentClips();
```

### Example 4: Device Control

```typescript
import { Host } from 'reolink-aio-ts';

async function controlDevices() {
  const host = new Host('192.168.1.100', 'admin', 'password');
  await host.getHostData();
  
  const channel = 0;
  
  // Turn on IR lights
  await host.setIrLights(channel, true);
  console.log('IR lights on');
  
  // Turn on spotlight
  await host.setSpotlight(channel, true);
  console.log('Spotlight on');
  
  // Activate siren for 5 seconds
  await host.setSiren(channel, true, 5);
  console.log('Siren activated');
  
  // Wait for siren to finish
  await new Promise(resolve => setTimeout(resolve, 6000));
  
  // Turn off lights
  await host.setIrLights(channel, false);
  await host.setSpotlight(channel, false);
  console.log('Lights off');
}

controlDevices();
```

## Type Reference

### VODTrigger (Enum)

Bit flags for recording triggers. Can be combined with bitwise OR.

```typescript
enum VODTrigger {
  NONE = 0,
  TIMER = 1,        // Scheduled recording
  MOTION = 2,       // Motion detection
  VEHICLE = 4,      // Vehicle AI
  ANIMAL = 8,       // Animal AI
  PERSON = 16,      // Person AI
  DOORBELL = 32,    // Doorbell press
  PACKAGE = 64,     // Package detection
  FACE = 128,       // Face detection
  IO = 256,         // IO trigger
  // ... more triggers
}
```

**Usage:**
```typescript
// Check multiple triggers
if (file.triggers & (VODTrigger.PERSON | VODTrigger.VEHICLE)) {
  console.log('Person or vehicle detected');
}
```

### VODFile (Class)

Represents a recorded video file.

**Properties:**
- `type: string` - Stream type ('main' or 'sub')
- `startTime: Date` - Recording start time
- `endTime: Date` - Recording end time
- `duration: number` - Duration in milliseconds
- `fileName: string` - File name
- `size: number` - File size in bytes
- `triggers: VODTrigger` - Bit flags of trigger types

### VodRequestType (Enum)

```typescript
enum VodRequestType {
  RTMP = 'RTMP',
  PLAYBACK = 'Playback',
  FLV = 'FLV',
  DOWNLOAD = 'Download',
  NVR_DOWNLOAD = 'NvrDownload'
}
```

### Enums

See [src/enums/index.ts](src/enums/index.ts) for complete list of enums including:
- `SpotlightModeEnum` - Spotlight operation modes
- `DayNightEnum` - Day/night mode settings
- `PtzEnum` - PTZ movement commands
- `BatteryEnum` - Battery status
- `ChimeToneEnum` - Doorbell chime tones
- And more...

## Error Handling

The library throws specific error types:

```typescript
import { 
  ReolinkError,
  ApiError,
  CredentialsInvalidError,
  LoginError,
  NoDataError,
  NotSupportedError,
  InvalidParameterError
} from 'reolink-aio-ts';

try {
  await host.getHostData();
} catch (error) {
  if (error instanceof CredentialsInvalidError) {
    console.error('Invalid credentials');
  } else if (error instanceof NoDataError) {
    console.error('Data not available yet');
  } else if (error instanceof NotSupportedError) {
    console.error('Feature not supported');
  } else if (error instanceof ApiError) {
    console.error('API error:', error.rspCode);
  }
}
```

## Debugging

Enable debug logging:

```bash
export REOLINK_AIO_DEBUG=1
node your-script.js
```

This will output detailed information about:
- HTTP requests/responses
- Baichuan protocol messages
- Authentication flow
- Binary protocol data

## Best Practices

1. **Always call getHostData() first**
   ```typescript
   const host = new Host(...);
   await host.getHostData(); // Required!
   ```

2. **Handle errors appropriately**
   ```typescript
   try {
     await host.setSiren(0, true);
   } catch (error) {
     console.error('Failed to activate siren:', error);
   }
   ```

3. **Clean up connections**
   ```typescript
   // Close Baichuan connection when done
   await host.baichuan.close();
   ```

4. **Use type guards for AI detection**
   ```typescript
   const aiTypes = ['person', 'vehicle', 'dog_cat'] as const;
   for (const type of aiTypes) {
     if (host.aiDetected(0, type)) {
       // Handle detection
     }
   }
   ```

5. **Filter VOD files by trigger type**
   ```typescript
   const motionClips = files.filter(f => f.triggers & VODTrigger.MOTION);
   const aiClips = files.filter(f => 
     f.triggers & (VODTrigger.PERSON | VODTrigger.VEHICLE | VODTrigger.ANIMAL)
   );
   ```

## TypeScript Support

The library is written in TypeScript and includes full type definitions. Your IDE will provide autocomplete and type checking:

```typescript
import { Host, VODFile, VODTrigger } from 'reolink-aio-ts';

const host: Host = new Host('192.168.1.100', 'admin', 'password');

// TypeScript knows the return type
const files: VODFile[] = await host.requestVodFiles(0, start, end);

// Enum autocomplete
const trigger: VODTrigger = VODTrigger.PERSON | VODTrigger.VEHICLE;
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support

- **Issues**: https://github.com/verheesj/reolink-aio-ts/issues
- **Documentation**: This file and inline JSDoc comments
- **Examples**: See [examples/](examples/) directory
