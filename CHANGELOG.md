# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.1] - 2025-01-XX

### Added

#### PTZ (Pan/Tilt/Zoom) Control - Complete Implementation

- **PTZ Movement** - Manual pan/tilt/zoom control with speed settings
- **Preset Management** - Get presets, go to preset by ID or name
- **Patrol Management** - Get patrols, start/stop auto patrol
- **Position Tracking** - Get current pan/tilt positions
- **Guard Functionality** - Set/goto guard position, configure return time
- **PTZ Calibration** - Reset and calibrate PTZ mechanisms
- **Auto-Tracking** - Enable/disable object tracking with configurable settings
  - Disappear time and stop time configuration
  - Tracking method selection (digital, digitalfirst, pantiltfirst)
  - Tracking limit configuration (left/right pan limits)
- **Comprehensive PTZ Methods**:
  - `ptzControl(channel, command?, preset?, speed?, patrol?)` - Flexible PTZ control
  - `gotoPreset(channel, preset)` - Quick preset navigation
  - `getPtzPresets(channel)` / `getPtzPatrols(channel)` - List available positions
  - `startPatrol(channel)` / `stopPatrol(channel)` - Patrol control
  - `getPtzPanPosition(channel)` / `getPtzTiltPosition(channel)` - Position getters
  - `isPtzGuardEnabled(channel)` / `getPtzGuardTime(channel)` - Guard status
  - `setPtzGuard(channel, command?, enable?, time?)` - Guard configuration
  - `ptzCalibrate(channel)` - PTZ calibration
  - `isAutoTrackingEnabled(channel)` - Tracking status
  - `setAutoTracking(channel, enable?, disappearTime?, stopTime?, method?)` - Tracking config
  - `getAutoTrackMethod(channel)` - Current tracking method
  - `getAutoTrackLimitLeft/Right(channel)` - Tracking limit getters
  - `setAutoTrackLimit(channel, left?, right?)` - Tracking limit configuration

#### Testing & Examples

- Added 67 comprehensive PTZ unit tests (100% passing)
- Created PTZ control example (`examples/08-ptz-control.ts`)
- Updated README with PTZ features and examples
- Updated API reference with all PTZ methods

## [0.1.0-alpha.0] - 2025-11-14

### Added - Initial Release

This is the first pre-release of `reolink-aio` - a TypeScript implementation of Reolink's Baichuan API (the same API used by official Reolink iOS/Android apps and CLI).

#### Core Features
- **Full TypeScript Support** - Complete type safety and IntelliSense
- **HTTP API Client** - Comprehensive REST API implementation  
- **Baichuan Protocol** - Real-time push events via TCP
- **NVR & Camera Support** - Works with both standalone cameras and NVR systems
- **Session Management** - Automatic token refresh and connection handling
- **Error Handling** - Rich exception hierarchy for robust error management

#### Real-Time Events
- Motion Detection - Real-time motion alerts via Baichuan
- AI Detection - Person, vehicle, pet/animal, face, and package detection
- Visitor Detection - Doorbell button press events
- State Monitoring - Continuous monitoring of camera states
- Event Subscription - Subscribe to push notifications

#### Video & Media
- VOD File Search - Find recordings by time range and event type
- Video Download - Download MP4 clips from NVR/cameras
- Multiple Streams - Support for main and sub streams
- Stream URLs - Generate FLV, RTMP, and RTSP URLs

#### Device Control
- IR Lights - Control infrared illumination
- Spotlight - Toggle camera spotlight with brightness control
- Siren - Activate camera siren/audio alarm (fully working!)
- Focus Control - Set camera focus position
- Zoom Control - Set camera zoom position

#### Device Information
- Device Discovery - Automatic NVR/camera detection
- Channel Management - Multi-channel support for NVRs
- Capability Detection - Automatic feature detection
- Model Information - Device model, firmware, hardware version
- Network Settings - Port configuration (RTSP, RTMP, ONVIF)

#### Testing & Documentation
- Comprehensive JSDoc documentation across all APIs
- Unit tests for utilities, types, and Baichuan protocol
- Working examples for common use cases
- API documentation guide

### Fixed
- Baichuan TCP protocol XML formatting (critical blank line separator fix for siren/control commands)
- Response future cleanup to prevent accumulation in long-running sessions

### Known Limitations

- ~~PTZ control not yet implemented~~ ✅ Completed in v0.1.0-alpha.1
- Snapshot capture not yet implemented
- Advanced configuration management (OSD, schedules, zones) not yet implemented
- Integration tests pending
- Code coverage ~30% (baseline established)

### Breaking Changes
- This is an initial pre-release; APIs may change in future versions

### Notes
- Based on the Python [reolink-aio](https://github.com/starkillerOG/reolink_aio) library
- Published under the `next` dist-tag on npm
- Requires Node.js 18+
- TypeScript 5.3+

[Unreleased]: https://github.com/verheesj/reolink-aio-ts/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/verheesj/reolink-aio-ts/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/verheesj/reolink-aio-ts/releases/tag/v0.1.0-alpha.0
