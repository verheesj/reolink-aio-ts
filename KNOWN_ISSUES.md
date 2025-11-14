# Known Issues

## ~~Baichuan TCP Connection Reset~~ ✅ RESOLVED

**Status:** ✅ **RESOLVED**  
**Resolution Date:** November 14, 2025  
**Severity:** ~~High~~ None

### Previous Issue

Previously, calling `getHostData()` could cause Baichuan TCP connection resets with ECONNRESET errors. This has been completely resolved.

### Root Cause (Identified)

The issue was caused by:
1. **Missing blank line in XML protocol** - The Extension and Body XML sections needed a blank line separator to match the Python reference implementation
2. **Incomplete future cleanup** - Response futures were not being properly cleaned up after completion, causing stale references

### Resolution

The following fixes were implemented:

1. **XML Protocol Alignment** (`src/baichuan/xmls.ts`)
   - Added proper blank line between Extension and Body XML sections
   - Now matches Python reolink_aio protocol exactly

2. **Future Cleanup** (`src/baichuan/tcp-protocol.ts`)
   - Added complete cleanup in `waitForResponse()` promise.finally() block
   - Prevents accumulation of stale futures in receiveFutures map

3. **API Completeness** (`src/api/host.ts`)
   - Added `cameraUid(channel)` method for consistency
   - Enhanced debugging capabilities

### Verification

All device control features now work correctly:
- ✅ IR Lights control
- ✅ Spotlight/Floodlight control with brightness
- ✅ **Siren control (AudioAlarmPlay)** - Now fully working!
- ✅ Focus control
- ✅ Zoom control
- ✅ Baichuan event subscriptions
- ✅ Motion/AI detection monitoring

**Tested on:** Reolink NVR at 192.168.0.79 with multiple camera channels

### Usage

All features work correctly when using proper initialization:

```typescript
import { Host } from 'reolink-aio';

const host = new Host('192.168.1.100', 'admin', 'password');

// Initialize connection (this now works perfectly)
await host.getHostData();

// All device control features work
await host.setIrLights(channel, true);
await host.setSpotlight(channel, true, 75);
await host.setSiren(channel, true, 2);  // ✅ Now working!
await host.setZoom(channel, 16);
await host.setFocus(channel, 128);

await host.logout();
```

See [examples/07-device-control.ts](examples/07-device-control.ts) for a complete working example.

---

## No Known Issues

There are currently **no known issues** with the library. All core functionality has been tested and verified working:

- ✅ HTTP API operations
- ✅ Baichuan TCP protocol
- ✅ Event subscriptions and monitoring
- ✅ Device control commands
- ✅ VOD file search and download
- ✅ Multi-channel NVR support

If you encounter any issues, please [open an issue on GitHub](https://github.com/verheesj/reolink-aio-ts/issues) with:
- Device model and firmware version
- Full error message and stack trace
- Minimal reproduction code
- Debug logs (enable with `REOLINK_AIO_DEBUG=1`)
