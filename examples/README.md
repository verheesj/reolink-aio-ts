# Reolink AIO TypeScript Examples

This directory contains practical examples demonstrating how to use the `reolink-aio` library.

## Prerequisites

1. Install dependencies:
```bash
npm install
```

2. Build the library:
```bash
npm run build
```

3. Configure your device credentials in each example file (replace `'your_password'` with your actual password).

## Examples

### 01-basic-connection.ts
**Basic Connection and Device Information**

Demonstrates how to:
- Connect to a Reolink device
- Get device information (name, model, channels, etc.)
- Display device capabilities and network ports

**Run:**
```bash
npx tsx examples/01-basic-connection.ts
```

---

### 02-get-video-clips.ts
**Get Video Clips**

Demonstrates how to:
- Search for video clips in a time range
- Filter clips by event type (motion, person, vehicle, etc.)
- Get playback URLs for clips
- Display clip information

**Run:**
```bash
npx tsx examples/02-get-video-clips.ts
```

---

### 03-motion-monitor.ts
**Real-time Motion Detection Monitor**

Demonstrates how to:
- Monitor motion detection in real-time
- Subscribe to Baichuan events
- Display motion events as they occur
- Track motion state changes

**Run:**
```bash
npx tsx examples/03-motion-monitor.ts
```

Press `Ctrl+C` to stop monitoring.

---

### 04-download-clips.ts
**Download Video Clips**

Demonstrates how to:
- Find video clips from a specific time range
- Filter clips by event type
- Download clips to local filesystem
- Organize downloads by event type

**Run:**
```bash
npx tsx examples/04-download-clips.ts
```

**Note:** Direct download functionality requires the `downloadVod` method to be fully implemented. Currently, the example shows how to get download URLs.

---

### 05-event-webhook.ts
**Event Webhook Server**

Demonstrates how to:
- Create a simple HTTP server to receive webhooks
- Monitor device events
- Send webhook notifications when events occur
- Handle different event types

**Run:**
```bash
npx tsx examples/05-event-webhook.ts
```

The server will listen on `http://localhost:3001/webhook`. Configure your Reolink device to send webhooks to this endpoint.

**Environment Variables:**
- `WEBHOOK_URL` - Custom webhook URL (default: `http://localhost:3001/webhook`)

---

### 06-scheduled-backup.ts
**Scheduled Video Backup**

Demonstrates how to:
- Schedule periodic backups of video clips
- Filter clips by event type
- Organize backups by date and event type
- Clean up old backups automatically

**Run:**
```bash
npx tsx examples/06-scheduled-backup.ts
```

The script will:
- Perform an initial backup
- Schedule backups every 60 minutes (configurable)
- Keep backups for 7 days (configurable)
- Automatically clean up old backups

**Configuration:**
Edit the `config` object in the script to customize:
- `backupDir` - Directory to store backups
- `retentionDays` - How long to keep backups
- `eventTypes` - Which event types to backup
- `scheduleInterval` - How often to run backups (in minutes)

---

### 07-device-control.ts
**Device Control**

Demonstrates how to:
- Control IR lights (infrared illumination)
- Control spotlight/floodlight with brightness
- Activate siren with duration (fully working!)
- Set zoom and focus positions (for supported cameras)
- Handle devices that don't support certain features

**Run:**
```bash
npx tsx examples/07-device-control.ts
```

**Note:** Not all cameras support all features. The example gracefully handles unsupported features. All control commands including siren are fully functional.

---

## Common Patterns

### Connecting to a Device

```typescript
import { Host } from '../src/api/host';

const host = new Host('192.168.0.79', 'admin', 'password');
await host.getHostData();
// ... use host ...
await host.logout();
```

### Getting Video Clips

```typescript
import { Host } from '../src/api/host';
import { VODTrigger } from '../src/enums';

const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
const endTime = new Date();
const [statuses, vodFiles] = await host.requestVodFiles(0, startTime, endTime);

// Filter by event type
const motionClips = vodFiles.filter(f => (f.triggers & VODTrigger.MOTION) !== 0);
```

### Monitoring Events

```typescript
await host.baichuan.subscribeEvents();
await host.getStates();

// Check states periodically
setInterval(async () => {
  await host.getStates();
  const motion = host.motionDetected(0);
  if (motion) {
    console.log('Motion detected!');
  }
}, 2000);
```

### Getting Playback URLs

```typescript
import { VodRequestType } from '../src/enums';

const [mimeType, url] = await host.getVodSource(
  channel,
  clip.fileName,
  'sub',
  VodRequestType.FLV
);
console.log(`Playback URL: ${url}`);
```

## Event Types

The library supports various event types via the `VODTrigger` enum:

- `VODTrigger.MOTION` - Motion detection
- `VODTrigger.PERSON` - Person detection
- `VODTrigger.VEHICLE` - Vehicle detection
- `VODTrigger.ANIMAL` - Animal/pet detection
- `VODTrigger.DOORBELL` - Doorbell press
- `VODTrigger.PACKAGE` - Package detection
- `VODTrigger.TIMER` - Scheduled recording
- `VODTrigger.FACE` - Face detection
- `VODTrigger.CRYING` - Crying detection
- `VODTrigger.CROSSLINE` - Cross-line detection
- `VODTrigger.INTRUSION` - Intrusion detection
- `VODTrigger.LINGER` - Loitering detection

## Troubleshooting

### Connection Issues

- Ensure the device IP address is correct
- Check that the device is on the same network
- Verify username and password are correct
- Some devices require HTTPS instead of HTTP

### No Video Clips Found

- Check the time range (clips may be outside the specified range)
- Verify that the channel has recordings enabled
- Ensure the device has sufficient storage space

### Event Monitoring Not Working

- Ensure Baichuan protocol is supported by your device
- Check that event subscriptions are enabled
- Verify network connectivity to the device

## Contributing

Feel free to add more examples! When creating a new example:

1. Follow the naming convention: `NN-description.ts`
2. Include a detailed header comment explaining what the example does
3. Add error handling
4. Include cleanup code (logout, unsubscribe, etc.)
5. Update this README with the new example

## License

Same as the main project.

