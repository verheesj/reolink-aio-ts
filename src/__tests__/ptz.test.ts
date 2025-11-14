import { Host } from '../api/host';
import { PtzEnum, GuardEnum, TrackMethodEnum } from '../enums';
import { InvalidParameterError, ApiError, NotSupportedError } from '../exceptions';

// Mock axios
jest.mock('axios');

describe('PTZ Functionality', () => {
  let host: Host;
  
  beforeEach(() => {
    // Create a test host instance
    host = new Host('192.168.1.100', 'admin', 'password');
    
    // Mock channels
    (host as any).channels = [0, 1];
    
    // Mock some PTZ data
    (host as any).ptzPresets.set(0, { 'Home': 0, 'Garage': 1, 'Front Door': 2 });
    (host as any).ptzPatrols.set(0, { 'patrol 0': 0 });
    (host as any).ptzGuardSettings.set(0, {
      PtzGuard: {
        benable: 1,
        bexistPos: 1,
        timeout: 120
      }
    });
    (host as any).ptzPosition.set(0, { Ppos: 1800, Tpos: 450 });
    (host as any).autoTrackSettings.set(0, {
      bSmartTrack: 1,
      aiDisappearBackTime: 10,
      aiStopBackTime: 20
    });
    (host as any).autoTrackLimits.set(0, {
      PtzTraceSection: {
        LimitLeft: 100,
        LimitRight: 2600
      }
    });
    
    // Mock the send method to avoid actual network calls
    jest.spyOn(host as any, 'send').mockResolvedValue([{ code: 0, value: {} }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getPtzPresets', () => {
    it('should return presets for a channel', () => {
      const presets = host.getPtzPresets(0);
      expect(presets).toEqual({ 'Home': 0, 'Garage': 1, 'Front Door': 2 });
    });

    it('should return empty object for channel without presets', () => {
      const presets = host.getPtzPresets(999);
      expect(presets).toEqual({});
    });
  });

  describe('getPtzPatrols', () => {
    it('should return patrols for a channel', () => {
      const patrols = host.getPtzPatrols(0);
      expect(patrols).toEqual({ 'patrol 0': 0 });
    });

    it('should return empty object for channel without patrols', () => {
      const patrols = host.getPtzPatrols(999);
      expect(patrols).toEqual({});
    });
  });

  describe('ptzControl', () => {
    it('should send PTZ command successfully', async () => {
      await host.ptzControl(0, PtzEnum.left);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'Left' } }],
        null,
        'json'
      );
    });

    it('should send PTZ command with speed', async () => {
      await host.ptzControl(0, PtzEnum.right, undefined, 32);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'Right', speed: 32 } }],
        null,
        'json'
      );
    });

    it('should send preset command with preset ID', async () => {
      await host.ptzControl(0, undefined, 2);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'ToPos', id: 2 } }],
        null,
        'json'
      );
    });

    it('should send preset command with preset name', async () => {
      await host.ptzControl(0, undefined, 'Home');
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'ToPos', id: 0 } }],
        null,
        'json'
      );
    });

    it('should throw error for invalid channel', async () => {
      await expect(host.ptzControl(999, PtzEnum.left)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for invalid command', async () => {
      await expect(host.ptzControl(0, 'InvalidCommand')).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for non-existent preset name', async () => {
      await expect(host.ptzControl(0, undefined, 'NonExistent')).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error when no command or preset specified', async () => {
      await expect(host.ptzControl(0)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for non-integer speed', async () => {
      await expect(host.ptzControl(0, PtzEnum.up, undefined, 32.5)).rejects.toThrow(InvalidParameterError);
    });

    it('should handle API error response', async () => {
      jest.spyOn(host as any, 'send').mockResolvedValue([{ code: -1 }]);
      
      await expect(host.ptzControl(0, PtzEnum.left)).rejects.toThrow(ApiError);
    });
  });

  describe('gotoPreset', () => {
    it('should goto preset by ID', async () => {
      await host.gotoPreset(0, 1);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'ToPos', id: 1 } }],
        null,
        'json'
      );
    });

    it('should goto preset by name', async () => {
      await host.gotoPreset(0, 'Garage');
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'ToPos', id: 1 } }],
        null,
        'json'
      );
    });
  });

  describe('startPatrol', () => {
    it('should start patrol successfully', async () => {
      await host.startPatrol(0);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'StartPatrol', id: 0 } }],
        null,
        'json'
      );
    });

    it('should throw error if no patrols configured', async () => {
      await expect(host.startPatrol(1)).rejects.toThrow(NotSupportedError);
    });
  });

  describe('stopPatrol', () => {
    it('should stop patrol successfully', async () => {
      await host.stopPatrol(0);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCtrl', action: 0, param: { channel: 0, op: 'StopPatrol', id: 0 } }],
        null,
        'json'
      );
    });

    it('should throw error if no patrols configured', async () => {
      await expect(host.stopPatrol(1)).rejects.toThrow(NotSupportedError);
    });
  });

  describe('getPtzPanPosition', () => {
    it('should return pan position', () => {
      expect(host.getPtzPanPosition(0)).toBe(1800);
    });

    it('should return null for channel without position', () => {
      expect(host.getPtzPanPosition(999)).toBe(null);
    });
  });

  describe('getPtzTiltPosition', () => {
    it('should return tilt position', () => {
      expect(host.getPtzTiltPosition(0)).toBe(450);
    });

    it('should return null for channel without position', () => {
      expect(host.getPtzTiltPosition(999)).toBe(null);
    });
  });

  describe('isPtzGuardEnabled', () => {
    it('should return true when guard is enabled', () => {
      expect(host.isPtzGuardEnabled(0)).toBe(true);
    });

    it('should return false when guard settings not available', () => {
      expect(host.isPtzGuardEnabled(999)).toBe(false);
    });

    it('should return false when guard not enabled', () => {
      (host as any).ptzGuardSettings.set(1, {
        PtzGuard: { benable: 0, bexistPos: 1, timeout: 60 }
      });
      expect(host.isPtzGuardEnabled(1)).toBe(false);
    });

    it('should return false when guard position not set', () => {
      (host as any).ptzGuardSettings.set(1, {
        PtzGuard: { benable: 1, bexistPos: 0, timeout: 60 }
      });
      expect(host.isPtzGuardEnabled(1)).toBe(false);
    });
  });

  describe('getPtzGuardTime', () => {
    it('should return guard timeout', () => {
      expect(host.getPtzGuardTime(0)).toBe(120);
    });

    it('should return default 60 when not configured', () => {
      expect(host.getPtzGuardTime(999)).toBe(60);
    });
  });

  describe('setPtzGuard', () => {
    it('should set guard position', async () => {
      await host.setPtzGuard(0, GuardEnum.set);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetPtzGuard',
          action: 0,
          param: {
            PtzGuard: {
              channel: 0,
              cmdStr: 'setPos',
              bSaveCurrentPos: 1
            }
          }
        }],
        null,
        'json'
      );
    });

    it('should enable guard with timeout', async () => {
      await host.setPtzGuard(0, undefined, true, 180);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetPtzGuard',
          action: 0,
          param: {
            PtzGuard: {
              channel: 0,
              cmdStr: 'setPos',
              benable: 1,
              timeout: 180
            }
          }
        }],
        null,
        'json'
      );
    });

    it('should goto guard position', async () => {
      await host.setPtzGuard(0, GuardEnum.goto);
      
      const call = (host as any).send.mock.calls[0][0][0];
      expect(call.param.PtzGuard.cmdStr).toBe('toPos');
      expect(call.param.PtzGuard.bSaveCurrentPos).toBeUndefined();
    });

    it('should throw error for invalid channel', async () => {
      await expect(host.setPtzGuard(999)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for non-integer timeout', async () => {
      await expect(host.setPtzGuard(0, undefined, undefined, 120.5)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for invalid command', async () => {
      await expect(host.setPtzGuard(0, 'invalid' as any)).rejects.toThrow(InvalidParameterError);
    });
  });

  describe('ptzCalibrate', () => {
    it('should calibrate PTZ successfully', async () => {
      await host.ptzCalibrate(0);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ cmd: 'PtzCheck', action: 0, param: { channel: 0 } }],
        null,
        'json'
      );
    });

    it('should throw error for invalid channel', async () => {
      await expect(host.ptzCalibrate(999)).rejects.toThrow(InvalidParameterError);
    });
  });

  describe('isAutoTrackingEnabled', () => {
    it('should return true when bSmartTrack is enabled', () => {
      expect(host.isAutoTrackingEnabled(0)).toBe(true);
    });

    it('should return true when aiTrack is enabled', () => {
      (host as any).autoTrackSettings.set(1, { aiTrack: 1 });
      (host as any).channels.push(1);
      expect(host.isAutoTrackingEnabled(1)).toBe(true);
    });

    it('should return false when not configured', () => {
      expect(host.isAutoTrackingEnabled(999)).toBe(false);
    });
  });

  describe('Auto-tracking getters', () => {
    it('should get disappear time', () => {
      expect(host.getAutoTrackDisappearTime(0)).toBe(10);
    });

    it('should get stop time', () => {
      expect(host.getAutoTrackStopTime(0)).toBe(20);
    });

    it('should get method', () => {
      (host as any).autoTrackSettings.set(1, { aiTrack: 2 });
      expect(host.getAutoTrackMethod(1)).toBe(2);
    });

    it('should return -1/null for unconfigured channel', () => {
      expect(host.getAutoTrackDisappearTime(999)).toBe(-1);
      expect(host.getAutoTrackStopTime(999)).toBe(-1);
      expect(host.getAutoTrackMethod(999)).toBe(null);
    });
  });

  describe('setAutoTracking', () => {
    it('should enable auto-tracking with bSmartTrack', async () => {
      await host.setAutoTracking(0, true);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetAiCfg',
          action: 0,
          param: { channel: 0, bSmartTrack: 1 }
        }],
        null,
        'json'
      );
    });

    it('should enable auto-tracking with aiTrack', async () => {
      (host as any).autoTrackSettings.set(1, { aiTrack: 0 });
      await host.setAutoTracking(1, true);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetAiCfg',
          action: 0,
          param: { channel: 1, aiTrack: 1 }
        }],
        null,
        'json'
      );
    });

    it('should set disappear and stop times', async () => {
      await host.setAutoTracking(0, undefined, 15, 25);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetAiCfg',
          action: 0,
          param: { 
            channel: 0,
            aiDisappearBackTime: 15,
            aiStopBackTime: 25
          }
        }],
        null,
        'json'
      );
    });

    it('should set tracking method by number', async () => {
      await host.setAutoTracking(0, undefined, undefined, undefined, 2);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetAiCfg',
          action: 0,
          param: { channel: 0, aiTrack: 2 }
        }],
        null,
        'json'
      );
    });

    it('should set tracking method by enum string', async () => {
      await host.setAutoTracking(0, undefined, undefined, undefined, 'digital');
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetAiCfg',
          action: 0,
          param: { channel: 0, aiTrack: 2 }
        }],
        null,
        'json'
      );
    });

    it('should throw error for invalid channel', async () => {
      await expect(host.setAutoTracking(999, true)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for invalid method', async () => {
      await expect(host.setAutoTracking(0, undefined, undefined, undefined, 999)).rejects.toThrow(InvalidParameterError);
    });
  });

  describe('Auto-tracking limits', () => {
    it('should get left limit', () => {
      expect(host.getAutoTrackLimitLeft(0)).toBe(100);
    });

    it('should get right limit', () => {
      expect(host.getAutoTrackLimitRight(0)).toBe(2600);
    });

    it('should return -1 for unconfigured channel', () => {
      expect(host.getAutoTrackLimitLeft(999)).toBe(-1);
      expect(host.getAutoTrackLimitRight(999)).toBe(-1);
    });
  });

  describe('setAutoTrackLimit', () => {
    it('should set left limit', async () => {
      await host.setAutoTrackLimit(0, 200);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetPtzTraceSection',
          action: 0,
          param: {
            PtzTraceSection: {
              channel: 0,
              LimitLeft: 200
            }
          }
        }],
        null,
        'json'
      );
    });

    it('should set right limit', async () => {
      await host.setAutoTrackLimit(0, undefined, 2500);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetPtzTraceSection',
          action: 0,
          param: {
            PtzTraceSection: {
              channel: 0,
              LimitRight: 2500
            }
          }
        }],
        null,
        'json'
      );
    });

    it('should set both limits', async () => {
      await host.setAutoTrackLimit(0, 150, 2550);
      
      expect((host as any).send).toHaveBeenCalledWith(
        [{ 
          cmd: 'SetPtzTraceSection',
          action: 0,
          param: {
            PtzTraceSection: {
              channel: 0,
              LimitLeft: 150,
              LimitRight: 2550
            }
          }
        }],
        null,
        'json'
      );
    });

    it('should disable limit with -1', async () => {
      await host.setAutoTrackLimit(0, -1, -1);
      
      const param = (host as any).send.mock.calls[0][0][0].param.PtzTraceSection;
      expect(param.LimitLeft).toBe(-1);
      expect(param.LimitRight).toBe(-1);
    });

    it('should throw error when neither limit specified', async () => {
      await expect(host.setAutoTrackLimit(0)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for invalid left limit', async () => {
      await expect(host.setAutoTrackLimit(0, -2)).rejects.toThrow(InvalidParameterError);
      await expect(host.setAutoTrackLimit(0, 2701)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for invalid right limit', async () => {
      await expect(host.setAutoTrackLimit(0, undefined, -2)).rejects.toThrow(InvalidParameterError);
      await expect(host.setAutoTrackLimit(0, undefined, 2701)).rejects.toThrow(InvalidParameterError);
    });

    it('should throw error for invalid channel', async () => {
      await expect(host.setAutoTrackLimit(999, 100)).rejects.toThrow(InvalidParameterError);
    });
  });

  describe('PTZ response parsing', () => {
    it('should parse GetPtzPreset response', () => {
      const jsonData = [{
        cmd: 'GetPtzPreset',
        code: 0,
        value: {
          PtzPreset: [
            { id: '0', name: 'Preset1', enable: '1' },
            { id: '1', name: 'Preset2', enable: '0' },  // Disabled
            { id: '2', name: 'Preset3', enable: '1' }
          ]
        }
      }];

      (host as any).mapChannelJsonResponse(jsonData, [0]);
      
      const presets = host.getPtzPresets(0);
      expect(presets).toEqual({ 'Preset1': 0, 'Preset3': 2 });
    });

    it('should parse GetPtzPatrol response', () => {
      const jsonData = [{
        cmd: 'GetPtzPatrol',
        code: 0,
        value: {
          PtzPatrol: [
            { id: '0', name: 'Patrol A', enable: '1' },
            { id: '1', enable: '1' },  // No name
            { id: '2', name: 'Patrol C', enable: '0' }  // Disabled
          ]
        }
      }];

      (host as any).mapChannelJsonResponse(jsonData, [1]);
      
      const patrols = host.getPtzPatrols(1);
      expect(patrols).toEqual({ 'Patrol A': 0, 'patrol 1': 1 });
    });

    it('should parse GetPtzGuard response', () => {
      const jsonData = [{
        cmd: 'GetPtzGuard',
        code: 0,
        value: {
          PtzGuard: {
            benable: 1,
            bexistPos: 1,
            timeout: 90
          }
        }
      }];

      (host as any).mapChannelJsonResponse(jsonData, [1]);
      
      expect(host.isPtzGuardEnabled(1)).toBe(true);
      expect(host.getPtzGuardTime(1)).toBe(90);
    });

    it('should parse GetPtzCurPos response', () => {
      const jsonData = [{
        cmd: 'GetPtzCurPos',
        code: 0,
        value: {
          PtzCurPos: {
            Ppos: 2700,
            Tpos: 720
          }
        }
      }];

      (host as any).mapChannelJsonResponse(jsonData, [1]);
      
      expect(host.getPtzPanPosition(1)).toBe(2700);
      expect(host.getPtzTiltPosition(1)).toBe(720);
    });
  });
});
