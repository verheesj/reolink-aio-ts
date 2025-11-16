import axios, { AxiosInstance } from "axios";
import { Baichuan } from "../baichuan/baichuan";
import { DEFAULT_PROTOCOL, DEFAULT_RTMP_AUTH_METHOD, DEFAULT_STREAM, DEFAULT_TIMEOUT, UNKNOWN } from "../constants";
import { DEFAULT_BC_PORT } from "../baichuan/util";
import {
  ApiError,
  CredentialsInvalidError,
  InvalidContentTypeError,
  InvalidParameterError,
  LoginError,
  LoginPrivacyModeError,
  NoDataError,
  NotSupportedError,
  ReolinkError
} from "../exceptions";
import { VodRequestType, PtzEnum, GuardEnum, TrackMethodEnum } from "../enums";
import { datetimeToReolinkTime } from "../utils";
import type { 
  ReolinkJson, 
  PtzPresetsResponse, 
  PtzPatrolsResponse, 
  PtzGuardResponse, 
  PtzCurPosResponse, 
  AutoTrackSettings, 
  AutoTrackLimits,
  OsdSettings,
  RecordingSettings,
  MdAlarmSettings,
  AiAlarmSettings,
  FtpSettings,
  EmailSettings,
  PushSettings,
  BuzzerSettings,
  NetPortSettings
} from "../types";
import { VODFile, VODSearchStatus } from "../types";

const DEBUG_ENABLED = Boolean(process?.env?.REOLINK_AIO_DEBUG);

function debugLog(message: string, ...args: Array<unknown>): void {
  if (DEBUG_ENABLED) {
    // eslint-disable-next-line no-console
    console.debug(`[reolink-aio][host] ${message}`, ...args);
  }
}

/**
 * Reolink network API class
 */
export class Host {
  // Public properties
  readonly host: string;
  readonly username: string;
  readonly password: string;
  readonly port: number | null;
  readonly useHttps: boolean | null;
  readonly protocol: string;
  readonly stream: string;
  readonly timeout: number;
  readonly rtmpAuthMethod: string;
  readonly baichuanOnly: boolean;

  // Baichuan protocol
  public baichuan: Baichuan;

  // Private properties
  private url: string = "";
  private rtspPort: number | null = null;
  private encSettings: Map<number, any> = new Map();
  private encPassword: string;
  private rtmpPort: number | null = null;
  private onvifPort: number | null = null;
  private rtspEnabled: boolean | null = null;
  private rtmpEnabled: boolean | null = null;
  private onvifEnabled: boolean | null = null;
  private macAddress: string | null = null;

  // Login session
  private token: string | null = null;
  private leaseTime: Date | null = null;
  private httpClient: AxiosInstance;

  // NVR (host-level) attributes
  private isNvr: boolean = false;
  private isHub: boolean = false;
  private numChannels: number = 0;

  // Combined attributes
  private name: Map<number | null, string> = new Map();
  private model: Map<number | null, string> = new Map();
  private hwVersion: Map<number | null, string> = new Map();
  private uid: Map<number | null, string> = new Map();
  private macAddressMap: Map<number | null, string> = new Map();
  private serial: Map<number | null, string> = new Map();
  private swVersion: Map<number | null, string> = new Map();

  // Channels
  private channels: Array<number> = [];
  private streamChannels: Array<number> = [];

  // States
  private motionDetectionStates: Map<number, boolean> = new Map();
  private aiDetectionStates: Map<number, Map<string, boolean>> = new Map();
  // Perimeter (Smart AI) detection: per channel, per type, set of active zone IDs
  private perimeterDetectionStates: Map<number, Map<string, Set<number>>> = new Map();
  private visitorStates: Map<number, boolean> = new Map();

  // Settings
  private hostDataRaw: Map<string, any> = new Map();
  private hddInfo: Array<any> = [];
  private irSettings: Map<number, any> = new Map();

  // PTZ settings
  private ptzPresets: Map<number, Record<string, number>> = new Map();
  private ptzPatrols: Map<number, Record<string, number>> = new Map();
  private ptzPresetsSettings: Map<number, any> = new Map();
  private ptzPatrolSettings: Map<number, any> = new Map();
  private ptzGuardSettings: Map<number, any> = new Map();
  private ptzPosition: Map<number, any> = new Map();
  private autoTrackSettings: Map<number, any> = new Map();
  private autoTrackLimits: Map<number, any> = new Map();

  // Configuration settings
  private osdSettings: Map<number, any> = new Map();
  private recordingSettings: Map<number, any> = new Map();
  private recordingRange: Map<number, any> = new Map();
  private mdAlarmSettings: Map<number, any> = new Map();
  private aiAlarmSettings: Map<number, Map<string, any>> = new Map();
  private ftpSettings: Map<number, any> = new Map();
  private emailSettings: Map<number, any> = new Map();
  private pushSettings: Map<number, any> = new Map();
  private buzzerSettings: Map<number, any> = new Map();
  private netportSettings: any = null;

  // Mutexes for async operations
  private sendMutex: Promise<void> = Promise.resolve();
  private loginMutex: Promise<void> = Promise.resolve();

  // Request batching configuration
  private static readonly MAX_CHUNK_ITEMS = 35; // Maximum items per request to avoid API errors
  private requestQueue: Array<{
    body: ReolinkJson;
    param: Record<string, any> | null;
    responseType: "json" | "image/jpeg";
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private static readonly BATCH_DELAY_MS = 10; // Delay before processing batch

  // Caching layer
  private cacheEnabled: boolean = true;
  private cacheTTL: number = 60000; // 60 seconds default TTL
  private responseCache: Map<string, { data: any; timestamp: number }> = new Map();

  constructor(
    host: string,
    username: string,
    password: string,
    port: number | null = null,
    useHttps: boolean | null = null,
    protocol: string = DEFAULT_PROTOCOL,
    stream: string = DEFAULT_STREAM,
    timeout: number = DEFAULT_TIMEOUT,
    rtmpAuthMethod: string = DEFAULT_RTMP_AUTH_METHOD,
    bcPort: number = DEFAULT_BC_PORT,
    bcOnly: boolean = false
  ) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.encPassword = encodeURIComponent(password);
    this.port = port;
    this.useHttps = useHttps;
    this.protocol = protocol;
    this.stream = stream;
    this.timeout = timeout;
    this.rtmpAuthMethod = rtmpAuthMethod;
    this.baichuanOnly = bcOnly;

    // Initialize HTTP client with SSL verification disabled (like Python version)
    // Enable connection pooling for better performance (matches Python's aiohttp.TCPConnector)
    const https = require('https');
    const http = require('http');
    this.httpClient = axios.create({
      timeout: this.timeout * 1000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        keepAliveMsecs: 30000, // 30 seconds
        maxSockets: 10,
        maxFreeSockets: 5,
        scheduling: 'lifo' as 'lifo' // Last In First Out - reuse most recently used sockets
      }),
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 10,
        maxFreeSockets: 5,
        scheduling: 'lifo' as 'lifo'
      }),
      validateStatus: () => true, // Don't throw on HTTP error status
      maxRedirects: 0
    });

    // Initialize Baichuan
    this.baichuan = new Baichuan(host, username, password, this, bcPort);

    this.refreshBaseUrl();
  }

  private refreshBaseUrl(): void {
    const protocol = this.useHttps === false ? "http" : this.useHttps === true ? "https" : "http";
    const port = this.port ? `:${this.port}` : "";
    this.url = `${protocol}://${this.host}${port}`;
  }

  /**
   * Get host data and capabilities
   */
  async getHostData(): Promise<void> {
    const body: ReolinkJson = [
      { cmd: "GetChannelstatus" },
      { cmd: "GetDevInfo", action: 0, param: {} },
      { cmd: "GetLocalLink", action: 0, param: {} },
      { cmd: "GetNetPort", action: 0, param: {} },
      { cmd: "GetP2p", action: 0, param: {} },
      { cmd: "GetHddInfo", action: 0, param: {} },
      { cmd: "GetUser", action: 0, param: {} },
      { cmd: "GetNtp", action: 0, param: {} },
      { cmd: "GetTime", action: 0, param: {} },
      { cmd: "GetPushCfg", action: 0, param: {} },
      { cmd: "GetAbility", action: 0, param: { User: { userName: this.username } } }
    ];

    try {
      const jsonData = await this.send(body, null, "json");
      this.hostDataRaw.set("host", jsonData);
      this.mapHostJsonResponse(jsonData);
    } catch (err) {
      if (err instanceof LoginPrivacyModeError) {
        if (!this.hostDataRaw.has("host")) {
          throw err;
        }
        debugLog(`Using old host data for ${this.host} because privacy mode is enabled`);
        const jsonData = this.hostDataRaw.get("host");
        this.mapHostJsonResponse(jsonData);
      } else {
        throw err;
      }
    }

    // Now get channel-specific data for each channel
    if (this.channels.length > 0) {
      await this.getChannelData();
    }

    // Get Baichuan capabilities
    await this.baichuan.getHostData();
  }

  /**
   * Get channel-specific data for all channels
   */
  private async getChannelData(): Promise<void> {
    const body: ReolinkJson = [];
    const channelMapping: Array<number> = []; // Maps each command to its channel

    // Build commands for each channel
    for (const channel of this.channels) {
      const chBody: ReolinkJson = [
        { cmd: "GetChnTypeInfo", action: 0, param: { channel: channel } },
        { cmd: "GetMdState", action: 0, param: { channel: channel } },
        { cmd: "GetAiState", action: 0, param: { channel: channel } },
        { cmd: "GetEvents", action: 0, param: { channel: channel } },
        { cmd: "GetIsp", action: 0, param: { channel: channel } },
        { cmd: "GetIrLights", action: 0, param: { channel: channel } },
        { cmd: "GetWhiteLed", action: 0, param: { channel: channel } },
        { cmd: "GetOsd", action: 0, param: { channel: channel } },
        { cmd: "GetPtzPreset", action: 0, param: { channel: channel } },
        { cmd: "GetPtzPatrol", action: 0, param: { channel: channel } },
        { cmd: "GetPtzGuard", action: 0, param: { channel: channel } },
        { cmd: "GetPtzCurPos", action: 0, param: { PtzCurPos: { channel: channel } } },
        { cmd: "GetAiCfg", action: 0, param: { channel: channel } },
        { cmd: "GetPtzTraceSection", action: 0, param: { PtzTraceSection: { channel: channel } } },
        { cmd: "GetAlarm", action: 0, param: { Alarm: { channel: channel, type: "md" } } },
        { cmd: "GetMdAlarm", action: 0, param: { channel: channel } },
        { cmd: "GetRecV20", action: 0, param: { channel: channel } },
        { cmd: "GetFtpV20", action: 0, param: { channel: channel } },
        { cmd: "GetEmailV20", action: 0, param: { channel: channel } },
        { cmd: "GetPushV20", action: 0, param: { channel: channel } },
        { cmd: "GetBuzzerAlarmV20", action: 0, param: { channel: channel } }
      ];

      body.push(...chBody);
      channelMapping.push(...new Array(chBody.length).fill(channel));
    }

    if (body.length === 0) {
      return;
    }

    try {
      const jsonData = await this.send(body, null, "json");
      this.hostDataRaw.set("channel", jsonData);
      this.mapChannelJsonResponse(jsonData, channelMapping);
    } catch (err) {
      debugLog(`Error getting channel data: ${err}`);
      // Continue even if channel data fails
    }
  }

  /**
   * Map channel JSON response to internal state
   */
  private mapChannelJsonResponse(jsonData: ReolinkJson, channelMapping: Array<number>): void {
    if (jsonData.length !== channelMapping.length) {
      debugLog(`Warning: Received ${jsonData.length} responses but expected ${channelMapping.length}`);
      return;
    }

    for (let i = 0; i < jsonData.length; i++) {
      const data = jsonData[i];
      const channel = channelMapping[i];

      if (data.code !== 0) {
        // Skip error responses - command not supported or failed
        debugLog(`Command ${data.cmd} on channel ${channel} failed with code ${data.code}`);
        continue;
      }

      try {
        if (data.cmd === "GetChnTypeInfo" && data.value) {
          const typeInfo = data.value.typeInfo;
          if (typeInfo && typeInfo !== "") {
            this.model.set(channel, typeInfo);
          }
          if (data.value.firmVer && data.value.firmVer !== "") {
            this.swVersion.set(channel, data.value.firmVer);
          }
          if (data.value.boardInfo && data.value.boardInfo !== "") {
            this.hwVersion.set(channel, data.value.boardInfo);
          }
        } else if (data.cmd === "GetMdState" && data.value) {
          this.motionDetectionStates.set(channel, data.value.state === 1);
        } else if (data.cmd === "GetAiState" && data.value) {
          // Parse AI state - can be old format (int) or new format (object with support/alarm_state)
          const aiStates = this.aiDetectionStates.get(channel) || new Map<string, boolean>();
          
          for (const [key, value] of Object.entries(data.value)) {
            if (key === "channel") {
              continue;
            }
            
            if (typeof value === "number") {
              // Old format: direct int value
              aiStates.set(key, value === 1);
            } else if (typeof value === "object" && value !== null) {
              // New format: { support: 0|1, alarm_state: 0|1 }
              const supported = (value as any).support === 1;
              if (supported) {
                aiStates.set(key, (value as any).alarm_state === 1);
              }
            }
          }
          
          this.aiDetectionStates.set(channel, aiStates);
        } else if (data.cmd === "GetEvents" && data.value) {
          // Parse events which may contain md, ai, visitor
          if (data.value.md && data.value.md.support === 1) {
            this.motionDetectionStates.set(channel, data.value.md.alarm_state === 1);
          }
          
          if (data.value.ai) {
            const aiStates = this.aiDetectionStates.get(channel) || new Map<string, boolean>();
            for (const [key, value] of Object.entries(data.value.ai)) {
              if (key === "other" && (value as any).support === 1) {
                // Battery cams use PIR detection with "other" item
                this.motionDetectionStates.set(channel, (value as any).alarm_state === 1);
              } else if ((value as any).support === 1) {
                aiStates.set(key, (value as any).alarm_state === 1);
              }
            }
            this.aiDetectionStates.set(channel, aiStates);
          }
          
          if (data.value.visitor) {
            const visitor = data.value.visitor;
            if (visitor.support === 1) {
              this.visitorStates.set(channel, visitor.alarm_state === 1);
            }
          }
        } else if (data.cmd === "GetIrLights" && data.value) {
          this.irSettings.set(channel, data.value);
        } else if (data.cmd === "GetOsd" && data.value && data.value.Osd) {
          this.osdSettings.set(channel, data.value);
          const osd = data.value.Osd;
          if (osd.osdChannel && osd.osdChannel.name) {
            this.name.set(channel, osd.osdChannel.name);
          }
        } else if (data.cmd === "GetAlarm" && data.value) {
          // GetAlarm response - merge with existing settings or create new
          const existing = this.mdAlarmSettings.get(channel) || {};
          this.mdAlarmSettings.set(channel, { ...existing, ...data.value });
        } else if (data.cmd === "GetMdAlarm" && data.value) {
          // GetMdAlarm response - merge with existing settings or create new
          const existing = this.mdAlarmSettings.get(channel) || {};
          this.mdAlarmSettings.set(channel, { ...existing, ...data.value });
        } else if (data.cmd === "GetRecV20" && data.value) {
          this.recordingSettings.set(channel, data.value);
        } else if (data.cmd === "GetFtpV20" && data.value) {
          this.ftpSettings.set(channel, data.value);
        } else if (data.cmd === "GetEmailV20" && data.value) {
          this.emailSettings.set(channel, data.value);
        } else if (data.cmd === "GetPushV20" && data.value) {
          this.pushSettings.set(channel, data.value);
        } else if (data.cmd === "GetBuzzerAlarmV20" && data.value) {
          this.buzzerSettings.set(channel, data.value);
        } else if (data.cmd === "GetPtzPreset" && data.value) {
          this.ptzPresetsSettings.set(channel, data.value);
          const presets: Record<string, number> = {};
          if (data.value.PtzPreset && Array.isArray(data.value.PtzPreset)) {
            for (const preset of data.value.PtzPreset) {
              if (parseInt(preset.enable, 10) === 1) {
                presets[preset.name] = parseInt(preset.id, 10);
              }
            }
          }
          this.ptzPresets.set(channel, presets);
        } else if (data.cmd === "GetPtzPatrol" && data.value) {
          this.ptzPatrolSettings.set(channel, data.value);
          const patrols: Record<string, number> = {};
          if (data.value.PtzPatrol && Array.isArray(data.value.PtzPatrol)) {
            for (const patrol of data.value.PtzPatrol) {
              if (parseInt(patrol.enable, 10) === 1) {
                const patrolName = patrol.name || `patrol ${patrol.id}`;
                patrols[patrolName] = parseInt(patrol.id, 10);
              }
            }
          }
          this.ptzPatrols.set(channel, patrols);
        } else if (data.cmd === "GetPtzGuard" && data.value) {
          this.ptzGuardSettings.set(channel, data.value);
        } else if (data.cmd === "GetPtzCurPos" && data.value) {
          this.ptzPosition.set(channel, data.value.PtzCurPos || {});
        } else if (data.cmd === "GetAiCfg" && data.value) {
          this.autoTrackSettings.set(channel, data.value);
        } else if (data.cmd === "GetPtzTraceSection" && data.value) {
          this.autoTrackLimits.set(channel, data.value);
        }
      } catch (err) {
        debugLog(`Error parsing channel response for ${data.cmd} on channel ${channel}: ${err}`);
      }
    }
  }

  /**
   * Refresh motion/AI/visitor states for all channels.
   * Currently implemented via polling the HTTP API since the Baichuan socket
   * layer is not wired up yet. Once Baichuan state streaming lands we can
   * switch this back to the lower-level implementation.
   */
  async getStates(_cmdList?: any, _wake?: Map<number, boolean>): Promise<void> {
    if (this.channels.length === 0) {
      return;
    }

    // Build a single request with all commands for all channels
    const body: ReolinkJson = [];
    const channelMapping: Array<number> = [];
    const commands: Array<string> = ["GetEvents", "GetMdState", "GetAiState"];

    for (const channel of this.channels) {
      for (const cmd of commands) {
        body.push({ cmd, action: 0, param: { channel } });
        channelMapping.push(channel);
      }
    }

    if (body.length === 0) {
      return;
    }

    try {
      const jsonData = await this.send(body, null, "json");
      this.mapChannelJsonResponse(jsonData, channelMapping);
    } catch (err) {
      debugLog(`Error refreshing states: ${err}`);
    }
  }

  /**
   * Send HTTP request to device with batching and caching support
   * Splits large requests into chunks and implements response caching
   */
  private async send(
    body: ReolinkJson,
    param: Record<string, any> | null = null,
    expectedResponseType: "json" | "image/jpeg" = "json"
  ): Promise<any> {
    // Check cache first (only for read operations)
    if (this.cacheEnabled && expectedResponseType === "json") {
      const cacheKey = this.getCacheKey(body, param);
      const cached = this.responseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
        debugLog(`Cache hit for key: ${cacheKey.substring(0, 50)}...`);
        return cached.data;
      }
    }

    // Periodically clear expired cache entries
    if (this.responseCache.size > 100) {
      this.clearExpiredCache();
    }

    // Split large requests into chunks (like Python's send method)
    // Maximum MAX_CHUNK_ITEMS per request to avoid API errors
    if (body.length > Host.MAX_CHUNK_ITEMS && expectedResponseType === "json") {
      debugLog(`Splitting large request (${body.length} items) into chunks of ${Host.MAX_CHUNK_ITEMS}`);
      const responses: any[] = [];
      for (let i = 0; i < body.length; i += Host.MAX_CHUNK_ITEMS) {
        const chunk = body.slice(i, i + Host.MAX_CHUNK_ITEMS);
        debugLog(`Sending chunk ${Math.floor(i / Host.MAX_CHUNK_ITEMS) + 1}/${Math.ceil(body.length / Host.MAX_CHUNK_ITEMS)}`);
        const chunkResponse = await this.sendChunk(chunk, param, expectedResponseType);
        if (Array.isArray(chunkResponse)) {
          responses.push(...chunkResponse);
        }
      }
      return responses;
    }

    return this.sendChunk(body, param, expectedResponseType);
  }

  /**
   * Internal method to send a single chunk of requests
   */
  private async sendChunk(
    body: ReolinkJson,
    param: Record<string, any> | null = null,
    expectedResponseType: "json" | "image/jpeg" = "json"
  ): Promise<any> {
    // Acquire send mutex
    await this.sendMutex;
    let releaseMutex: () => void;
    this.sendMutex = new Promise((resolve) => {
      releaseMutex = resolve;
    });

    try {
      // Ensure logged in
      if (!this.token || !this.leaseTime || this.leaseTime <= new Date()) {
        await this.login();
      }

      const url = `${this.url}/api.cgi`;
      
      // Build params
      if (!param) {
        param = {};
      }
      if (this.token) {
        param.token = this.token;
      }

      // Configure response type for binary data
      const config: any = { params: param };
      if (expectedResponseType === "image/jpeg") {
        config.responseType = "arraybuffer";
      }

      // Use POST with JSON body (like Python version)
      const response = await this.httpClient.post(url, body, config);

      if (response.status === 300) {
        throw new ApiError(
          `API returned HTTP status ERROR code ${response.status}, this may happen if you use HTTP and the camera expects HTTPS`,
          "",
          response.status
        );
      }

      if (response.status >= 400) {
        throw new ApiError(`API returned HTTP status ERROR code ${response.status}`, "", response.status);
      }

      // Handle binary responses (images)
      if (expectedResponseType === "image/jpeg") {
        if (response.data instanceof ArrayBuffer) {
          return Buffer.from(response.data);
        }
        return response.data;
      }

      // Parse response
      let data: any;
      if (typeof response.data === 'string') {
        // Check for HTML error responses
        if (response.data.length < 500 && response.headers['content-type']?.includes('text/html')) {
          const loginErr = response.data.includes('"detail" : "please login first"');
          const credErr =
            response.data.includes('"detail" : "invalid user"') ||
            response.data.includes('"detail" : "login failed"') ||
            response.data.includes('"detail" : "password wrong"') ||
            response.data.includes("Login has been locked");
          
          if (loginErr || credErr) {
            this.token = null;
            this.leaseTime = null;
            if (credErr) {
              throw new CredentialsInvalidError(`Invalid credentials: ${response.data}`);
            }
            throw new LoginError(`Login error: ${response.data}`);
          }
        }
        
        try {
          data = JSON.parse(response.data);
        } catch {
          throw new InvalidContentTypeError(`Failed to parse JSON response: ${response.data.substring(0, 200)}`);
        }
      } else {
        data = response.data;
      }

      if (Array.isArray(data) && data.length > 0) {
        // Cache the response for read operations
        if (this.cacheEnabled && expectedResponseType === "json") {
          const cacheKey = this.getCacheKey(body, param);
          this.responseCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
          });
        }

        // Check for critical errors only in single-command requests
        // For batch requests, let caller handle individual error codes
        if (data.length === 1) {
          const item = data[0];
          if (item.code !== 0) {
            // Code 1 can mean "ability error" (not supported) or invalid credentials
            // Only throw credentials error during login, otherwise return the response
            // and let the caller decide how to handle it
            if (item.code === 1 && item.cmd === "Login") {
              throw new CredentialsInvalidError(`Invalid credentials: ${item.detail || ""}`);
            }
            // Ignore responses for unsupported commands (cmd: "Unknown", code: 1)
            // This prevents error spam when polling for state on cameras that don't support certain features
            if (item.code === 1 && item.cmd === "Unknown") {
              debugLog(`Ignoring unsupported command response: ${JSON.stringify(item)}`);
              return [];
            }
            // For other commands, return the error response and let caller handle it
            // Don't throw here - the caller will check the code
          }
        }
        return data;
      }

      throw new NoDataError(`Host ${this.host}:${this.port} returned no data`);
    } finally {
      releaseMutex!();
    }
  }

  /**
   * Login to device
   */
  async login(): Promise<void> {
    await this.loginMutex;
    let releaseMutex: () => void;
    this.loginMutex = new Promise((resolve) => {
      releaseMutex = resolve;
    });

    try {
      // Check if already logged in
      if (this.token && this.leaseTime && this.leaseTime > new Date(Date.now() + 300000)) {
        return; // Already logged in with valid token
      }

      const url = `${this.url}/api.cgi`;
      const body: ReolinkJson = [
        {
          cmd: "Login",
          action: 0,
          param: {
            User: {
              userName: this.username,
              password: this.password
            }
          }
        }
      ];

      // For login, token should be "null" in params
      const params: Record<string, string> = {
        cmd: "Login",
        token: "null"
      };

      debugLog(`Login request URL: ${url}`);
      debugLog(`Login request body: ${JSON.stringify(body)}`);
      debugLog(`Login request params: ${JSON.stringify(params)}`);

      // Use POST with JSON body (like Python version)
      const response = await this.httpClient.post(url, body, { 
        params,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      debugLog(`Login response status: ${response.status}, content-type: ${response.headers['content-type']}`);
      debugLog(`Login response data (first 500 chars): ${typeof response.data === 'string' ? response.data.substring(0, 500) : JSON.stringify(response.data).substring(0, 500)}`);

      if (response.status === 300) {
        throw new ApiError(
          `API returned HTTP status ERROR code ${response.status}, this may happen if you use HTTP and the camera expects HTTPS`,
          "",
          response.status
        );
      }

      if (response.status >= 400) {
        throw new LoginError(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse response - Reolink API returns JSON as text/html content type
      let data: any;
      if (typeof response.data === 'string') {
        debugLog(`Login response is string, length: ${response.data.length}`);
        debugLog(`Login response content: ${response.data.substring(0, 1000)}`);
        
        // Check for credential errors in HTML response
        if (response.data.includes('"detail" : "invalid user"') ||
            response.data.includes('"detail" : "login failed"') ||
            response.data.includes('"detail" : "password wrong"') ||
            response.data.includes("Login has been locked")) {
          debugLog("Detected credential error in response");
          throw new CredentialsInvalidError("Invalid credentials");
        }
        
        try {
          data = JSON.parse(response.data);
        } catch (parseErr) {
          debugLog(`Failed to parse JSON, response was: ${response.data}`);
          throw new LoginError(`Failed to parse login response: ${response.data.substring(0, 200)}`);
        }
      } else {
        data = response.data;
      }

      if (!Array.isArray(data) || data.length === 0) {
        throw new LoginError("No data received from login");
      }

      const loginResponse = data[0];
      if (loginResponse.code !== 0) {
        if (loginResponse.code === 1) {
          throw new CredentialsInvalidError("Invalid credentials");
        }
        throw new LoginError(`Login failed: ${loginResponse.detail || loginResponse.code}`);
      }

      this.token = loginResponse.value?.Token?.name || null;
      if (!this.token) {
        throw new LoginError("No token received from login");
      }

      // Calculate lease time (typically 3600 seconds)
      const leaseTime = loginResponse.value?.Token?.leaseTime || 3600;
      this.leaseTime = new Date(Date.now() + leaseTime * 1000);

      debugLog(`Logged in successfully, token expires at ${this.leaseTime}`);
    } finally {
      releaseMutex!();
    }
  }

  /**
   * Logout from device
   */
  async logout(): Promise<void> {
    if (this.baichuan.subscribedValue) {
      await this.baichuan.unsubscribeEvents();
    }

    if (this.token) {
      try {
        const url = `${this.url}/api.cgi`;
        const body: ReolinkJson = [
          {
            cmd: "Logout",
            action: 0,
            param: {}
          }
        ];

        const params = {
          token: this.token
        };

        await this.httpClient.post(url, body, { params });
      } catch (err) {
        debugLog(`Logout error: ${err}`);
      }
    }

    this.token = null;
    this.leaseTime = null;
  }

  /**
   * Map host JSON response to internal state
   */
  private mapHostJsonResponse(jsonData: ReolinkJson): void {
    for (const item of jsonData) {
      if (item.cmd === "GetDevInfo" && item.value) {
        const devInfo = item.value.DevInfo;
        if (devInfo) {
          this.name.set(null, devInfo.devName || UNKNOWN);
          this.model.set(null, devInfo.type || UNKNOWN);
          this.hwVersion.set(null, devInfo.hardwareVersion || UNKNOWN);
          this.uid.set(null, devInfo.UID || UNKNOWN);
          
          // Determine if this is an NVR
          const exactType = devInfo.exactType || 'IPC';
          const type = devInfo.type || 'IPC';
          this.isNvr = ['NVR', 'WIFI_NVR', 'HOMEHUB'].includes(exactType) || 
                       ['NVR', 'WIFI_NVR', 'HOMEHUB'].includes(type);
        }
      } else if (item.cmd === "GetNetPort" && item.value) {
        // Store full NetPort settings
        this.netportSettings = item.value;
        const netPort = item.value.NetPort;
        if (netPort) {
          this.rtspPort = netPort.rtspPort || null;
          this.rtmpPort = netPort.rtmpPort || null;
          this.onvifPort = netPort.onvifPort || null;
          this.rtspEnabled = netPort.rtspEnable === 1;
          this.rtmpEnabled = netPort.rtmpEnable === 1;
          this.onvifEnabled = netPort.onvifEnable === 1;
        }
      } else if (item.cmd === "GetLocalLink" && item.value) {
        const localLink = item.value.LocalLink;
        if (localLink) {
          this.macAddress = localLink.mac || null;
        }
      } else if (item.cmd === "GetChannelstatus" && item.value) {
        // Python version uses: data["value"]["status"] and data["value"]["count"]
        const status = item.value.status;
        const count = item.value.count;
        
        if (count !== undefined && count > 0) {
          this.numChannels = count;
        }
        
        if (status && Array.isArray(status)) {
          this.channels = [];
          for (const chInfo of status) {
            // Only add online channels (online === 1)
            if (chInfo.online === 1 && chInfo.channel !== undefined) {
              const curChannel = chInfo.channel;
              this.channels.push(curChannel);
              
              // Store model if available
              if (chInfo.typeInfo) {
                this.model.set(curChannel, chInfo.typeInfo);
              }
              
              // Store UID if available
              if (chInfo.uid && chInfo.uid !== "") {
                this.uid.set(curChannel, chInfo.uid);
              }
            }
          }
          
          // If count wasn't provided, use length of channels array
          if (this.numChannels === 0 && this.channels.length > 0) {
            this.numChannels = this.channels.length;
          }
        }
      }
    }
  }

  // Property getters
  get onvifPortValue(): number | null {
    return this.onvifPort;
  }

  get rtmpPortValue(): number | null {
    return this.rtmpPort;
  }

  get rtspPortValue(): number | null {
    return this.rtspPort;
  }

  get onvifEnabledValue(): boolean | null {
    return this.onvifEnabled;
  }

  get rtmpEnabledValue(): boolean | null {
    return this.rtmpEnabled;
  }

  get rtspEnabledValue(): boolean | null {
    return this.rtspEnabled;
  }

  get macAddressValue(): string {
    if (this.macAddress === null) {
      throw new NoDataError("Mac address not yet retrieved");
    }
    return this.macAddress;
  }

  get isNvrValue(): boolean {
    return this.isNvr;
  }

  get isHubValue(): boolean {
    return this.isHub;
  }

  get nvrName(): string {
    return this.cameraName(null);
  }

  get numChannel(): number {
    return this.numChannels;
  }

  get channelsValue(): Array<number> {
    return this.channels;
  }

  get sessionActive(): boolean {
    if (this.baichuanOnly) {
      return this.baichuan.sessionActive;
    }
    if (this.token && this.leaseTime && this.leaseTime > new Date(Date.now() + 5000)) {
      return true;
    }
    return false;
  }

  // Channel-level getters
  cameraName(channel: number | null): string {
    return this.name.get(channel) || UNKNOWN;
  }

  cameraModel(channel: number | null): string {
    return this.model.get(channel) || UNKNOWN;
  }

  cameraUid(channel: number | null): string {
    return this.uid.get(channel) || UNKNOWN;
  }

  cameraHardwareVersion(channel: number | null): string {
    return this.hwVersion.get(channel) || UNKNOWN;
  }

  cameraSwVersion(channel: number | null): string {
    return this.swVersion.get(channel) || UNKNOWN;
  }

  // State getters
  motionDetected(channel: number): boolean {
    return this.motionDetectionStates.get(channel) || false;
  }

  aiDetected(channel: number, objectType: string): boolean {
    const aiVal = this.aiDetectionStates.get(channel)?.get(objectType);
    return typeof aiVal === 'boolean' ? aiVal : false;
  }

  // Perimeter (Smart AI) helpers
  private perimeterDetected(channel: number, perimeterType: string): boolean {
    const zones = this.perimeterDetectionStates.get(channel)?.get(perimeterType);
    return zones ? zones.size > 0 : false;
  }

  crosslineDetected(channel: number): boolean {
    return this.perimeterDetected(channel, 'crossline');
  }

  intrusionDetected(channel: number): boolean {
    return this.perimeterDetected(channel, 'intrusion');
  }

  loiteringDetected(channel: number): boolean {
    return this.perimeterDetected(channel, 'loitering');
  }

  // Some firmwares use legacy/loss for forgotten/taken
  forgottenDetected(channel: number): boolean {
    return this.perimeterDetected(channel, 'legacy');
  }

  takenDetected(channel: number): boolean {
    return this.perimeterDetected(channel, 'loss');
  }

  /**
   * Get detailed zone information for a perimeter type
   * @param channel - Channel number
   * @param perimeterType - Type: 'crossline', 'intrusion', 'loitering', 'legacy', 'loss'
   * @returns Array of active zone IDs (from bitmask), or empty array
   */
  getPerimeterZones(channel: number, perimeterType: string): number[] {
    const zones = this.perimeterDetectionStates.get(channel)?.get(perimeterType);
    return zones ? Array.from(zones).sort((a, b) => a - b) : [];
  }

  visitorDetected(channel: number): boolean {
    return this.visitorStates.get(channel) || false;
  }

  irEnabled(channel: number): boolean {
    const irSettings = this.irSettings.get(channel);
    return irSettings?.IrLights?.state === "Auto";
  }

  /**
   * Control IR lights on a channel
   * @param channel - Channel number
   * @param enabled - true for Auto mode (IR on), false for Off mode
   */
  async setIrLights(channel: number, enabled: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setIrLights: no camera connected to channel '${channel}'`);
    }

    // Get current settings first
    if (!this.irSettings.has(channel)) {
      await this.getChannelData();
    }

    const currentSettings = this.irSettings.get(channel);
    if (!currentSettings) {
      throw new NotSupportedError(`setIrLights: IR lights not supported on channel ${channel}`);
    }

    const body: ReolinkJson = [
      {
        cmd: "SetIrLights",
        action: 0,
        param: {
          IrLights: {
            channel: channel,
            state: enabled ? "Auto" : "Off"
          }
        }
      }
    ];

    const jsonData = await this.send(body, { cmd: "SetIrLights" }, "json");
    
    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setIrLights failed with code ${jsonData[0]?.code || -1}`,
        "SetIrLights",
        jsonData[0]?.code || -1
      );
    }

    // Update cached state
    if (this.irSettings.has(channel)) {
      this.irSettings.get(channel)!.IrLights.state = enabled ? "Auto" : "Off";
    }
  }

  /**
   * Control spotlight/floodlight on a channel
   * @param channel - Channel number
   * @param enabled - true to turn on, false to turn off
   * @param brightness - Optional brightness level (0-100)
   */
  async setSpotlight(channel: number, enabled: boolean, brightness?: number): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setSpotlight: no camera connected to channel '${channel}'`);
    }

    if (brightness !== undefined && (brightness < 0 || brightness > 100)) {
      throw new InvalidParameterError(`setSpotlight: brightness ${brightness} must be between 0 and 100`);
    }

    const settings: Record<string, any> = {
      channel: channel,
      state: enabled ? 1 : 0
    };

    if (brightness !== undefined) {
      settings.bright = brightness;
    }

    // Note: SetWhiteLed does not use "action" field
    const body: ReolinkJson = [
      {
        cmd: "SetWhiteLed",
        param: {
          WhiteLed: settings
        }
      }
    ];

    const jsonData = await this.send(body, { cmd: "SetWhiteLed" }, "json");
    
    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setSpotlight failed with code ${jsonData[0]?.code || -1}`,
        "SetWhiteLed",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Control siren on a channel
   * Uses the Baichuan protocol AudioAlarmPlay command.
   * 
   * @param channel - Channel number (optional for NVRs)
   * @param enabled - true to turn on, false to turn off
   * @param duration - Duration in seconds (default: 2)
   * @param times - Number of times to play siren (default: 1, 0 for continuous)
   */
  async setSiren(channel: number | null = null, enabled: boolean = true, duration: number | null = 2, times: number | null = null): Promise<void> {
    // Validate channel if provided and channels are available
    if (channel !== null && this.channels.length > 0 && !this.channels.includes(channel)) {
      throw new InvalidParameterError(`setSiren: no camera connected to channel '${channel}'`);
    }

    const targetChannel = channel !== null ? channel : this.channels[0] ?? null;

  if (targetChannel === null && !this.isHub) {
      throw new InvalidParameterError('setSiren: no channels available');
    }

    if (!this.baichuan) {
      throw new NotSupportedError('setSiren: Baichuan protocol not initialized');
    }

    const plays = times ?? duration ?? 1;

    let alarmOptions: { alarmMode: "times" | "manual"; times?: number; manualSwitch?: boolean };

    if (enabled) {
      if (plays !== null && plays > 0) {
        alarmOptions = { alarmMode: "times", times: Math.max(1, Math.round(plays)) };
      } else {
        alarmOptions = { alarmMode: "manual", manualSwitch: true };
      }
    } else {
      alarmOptions = { alarmMode: "manual", manualSwitch: false };
    }

    await this.baichuan.audioAlarmPlay(targetChannel, alarmOptions);
  }

  /**
   * Set focus position on a channel
   * @param channel - Channel number
   * @param position - Focus position value (typically 0-255, range depends on camera)
   */
  async setFocus(channel: number, position: number): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setFocus: no camera connected to channel '${channel}'`);
    }

    if (!Number.isInteger(position) || position < 0) {
      throw new InvalidParameterError(`setFocus: position ${position} must be a non-negative integer`);
    }

    const body: ReolinkJson = [
      {
        cmd: "StartZoomFocus",
        action: 0,
        param: {
          ZoomFocus: {
            channel: channel,
            op: "FocusPos",
            pos: position
          }
        }
      }
    ];

    const jsonData = await this.send(body, null, "json");
    
    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setFocus failed with code ${jsonData[0]?.code || -1}`,
        "StartZoomFocus",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Set zoom position on a channel
   * @param channel - Channel number
   * @param position - Zoom position value (typically 0-33, range depends on camera)
   */
  async setZoom(channel: number, position: number): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setZoom: no camera connected to channel '${channel}'`);
    }

    if (!Number.isInteger(position) || position < 0) {
      throw new InvalidParameterError(`setZoom: position ${position} must be a non-negative integer`);
    }

    const body: ReolinkJson = [
      {
        cmd: "StartZoomFocus",
        action: 0,
        param: {
          ZoomFocus: {
            channel: channel,
            op: "ZoomPos",
            pos: position
          }
        }
      }
    ];

    const jsonData = await this.send(body, null, "json");
    
    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setZoom failed with code ${jsonData[0]?.code || -1}`,
        "StartZoomFocus",
        jsonData[0]?.code || -1
      );
    }
  }

  // PTZ (Pan-Tilt-Zoom) Methods

  /**
   * Get PTZ presets for a channel
   * Returns a map of preset names to preset IDs
   * @param channel - Channel number
   * @returns Map of preset names to IDs
   */
  getPtzPresets(channel: number): Record<string, number> {
    if (!this.ptzPresets.has(channel)) {
      return {};
    }
    return this.ptzPresets.get(channel)!;
  }

  /**
   * Get PTZ patrols for a channel
   * Returns a map of patrol names to patrol IDs
   * @param channel - Channel number
   * @returns Map of patrol names to IDs
   */
  getPtzPatrols(channel: number): Record<string, number> {
    if (!this.ptzPatrols.has(channel)) {
      return {};
    }
    return this.ptzPatrols.get(channel)!;
  }

  /**
   * Send a PTZ control command
   * @param channel - Channel number
   * @param command - PTZ command from PtzEnum (e.g., "Left", "Right", "Up", "Down", "ZoomInc", "ZoomDec")
   * @param preset - Preset ID or name to move to (uses "ToPos" command)
   * @param speed - Optional speed value for PTZ movement
   * @param patrol - Patrol ID to start/stop
   */
  async ptzControl(
    channel: number,
    command?: string,
    preset?: number | string,
    speed?: number,
    patrol?: number
  ): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`ptzControl: no camera connected to channel '${channel}'`);
    }

    if (speed !== undefined && !Number.isInteger(speed)) {
      throw new InvalidParameterError(`ptzControl: speed ${speed} must be an integer`);
    }

    const validCommands = Object.values(PtzEnum);
    if (command && !validCommands.includes(command as PtzEnum) && patrol === undefined) {
      throw new InvalidParameterError(
        `ptzControl: command '${command}' not in valid commands: ${validCommands.join(', ')}`
      );
    }

    let actualCommand = command;
    let presetId: number | undefined;

    // Handle preset
    if (preset !== undefined) {
      actualCommand = "ToPos";
      if (typeof preset === "string") {
        const presets = this.getPtzPresets(channel);
        if (!(preset in presets)) {
          throw new InvalidParameterError(
            `ptzControl: preset '${preset}' not in available presets: ${Object.keys(presets).join(', ')}`
          );
        }
        presetId = presets[preset];
      } else {
        if (!Number.isInteger(preset)) {
          throw new InvalidParameterError(`ptzControl: preset ${preset} must be an integer`);
        }
        presetId = preset;
      }
    }

    if (!actualCommand) {
      throw new InvalidParameterError("ptzControl: No command or preset specified");
    }

    const param: Record<string, any> = {
      channel: channel,
      op: actualCommand
    };

    if (speed !== undefined) {
      param.speed = speed;
    }
    if (presetId !== undefined) {
      param.id = presetId;
    }
    if (patrol !== undefined) {
      param.id = patrol;
    }

    const body: ReolinkJson = [
      {
        cmd: "PtzCtrl",
        action: 0,
        param: param
      }
    ];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `ptzControl failed with code ${jsonData[0]?.code || -1}`,
        "PtzCtrl",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Move PTZ camera to a preset position
   * @param channel - Channel number
   * @param preset - Preset ID or preset name
   */
  async gotoPreset(channel: number, preset: number | string): Promise<void> {
    await this.ptzControl(channel, undefined, preset);
  }

  /**
   * Start PTZ patrol
   * Starts the first available patrol for the channel
   * @param channel - Channel number
   */
  async startPatrol(channel: number): Promise<void> {
    const patrols = this.getPtzPatrols(channel);
    const patrolIds = Object.values(patrols);
    
    if (patrolIds.length === 0) {
      throw new NotSupportedError(`startPatrol: no patrols configured for channel ${channel}`);
    }

    await this.ptzControl(channel, "StartPatrol", undefined, undefined, patrolIds[0]);
  }

  /**
   * Stop PTZ patrol
   * Stops the first available patrol for the channel
   * @param channel - Channel number
   */
  async stopPatrol(channel: number): Promise<void> {
    const patrols = this.getPtzPatrols(channel);
    const patrolIds = Object.values(patrols);
    
    if (patrolIds.length === 0) {
      throw new NotSupportedError(`stopPatrol: no patrols configured for channel ${channel}`);
    }

    await this.ptzControl(channel, "StopPatrol", undefined, undefined, patrolIds[0]);
  }

  /**
   * Get current PTZ pan position
   * @param channel - Channel number
   * @returns Pan position (0-3600) or null if not available
   */
  getPtzPanPosition(channel: number): number | null {
    return this.ptzPosition.get(channel)?.Ppos ?? null;
  }

  /**
   * Get current PTZ tilt position
   * @param channel - Channel number
   * @returns Tilt position (0-900) or null if not available
   */
  getPtzTiltPosition(channel: number): number | null {
    return this.ptzPosition.get(channel)?.Tpos ?? null;
  }

  /**
   * Check if PTZ guard position is enabled
   * @param channel - Channel number
   * @returns true if guard is enabled and position exists
   */
  isPtzGuardEnabled(channel: number): boolean {
    if (!this.ptzGuardSettings.has(channel)) {
      return false;
    }

    const values = this.ptzGuardSettings.get(channel)?.PtzGuard;
    return values?.benable === 1 && values?.bexistPos === 1;
  }

  /**
   * Get PTZ guard return time
   * @param channel - Channel number
   * @returns Guard return time in seconds (default: 60)
   */
  getPtzGuardTime(channel: number): number {
    if (!this.ptzGuardSettings.has(channel)) {
      return 60;
    }

    return this.ptzGuardSettings.get(channel)?.PtzGuard?.timeout ?? 60;
  }

  /**
   * Set PTZ guard position
   * @param channel - Channel number
   * @param command - Guard command ("setPos" or "toPos")
   * @param enable - Enable/disable guard
   * @param time - Guard return time in seconds
   */
  async setPtzGuard(
    channel: number,
    command?: string,
    enable?: boolean,
    time?: number
  ): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setPtzGuard: no camera connected to channel '${channel}'`);
    }

    if (time !== undefined && !Number.isInteger(time)) {
      throw new InvalidParameterError(`setPtzGuard: guard time ${time} must be an integer`);
    }

    const validCommands = Object.values(GuardEnum);
    if (command && !validCommands.includes(command as GuardEnum)) {
      throw new InvalidParameterError(
        `setPtzGuard: command '${command}' not in valid commands: ${validCommands.join(', ')}`
      );
    }

    const params: Record<string, any> = {
      channel: channel
    };

    if (command) {
      params.cmdStr = command;
      if (command === GuardEnum.set) {
        params.bSaveCurrentPos = 1;
      }
    } else {
      params.cmdStr = GuardEnum.set;
    }

    if (enable !== undefined) {
      params.benable = enable ? 1 : 0;
    }

    if (time !== undefined) {
      params.timeout = time;
    }

    const body: ReolinkJson = [
      {
        cmd: "SetPtzGuard",
        action: 0,
        param: {
          PtzGuard: params
        }
      }
    ];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setPtzGuard failed with code ${jsonData[0]?.code || -1}`,
        "SetPtzGuard",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Calibrate PTZ camera
   * @param channel - Channel number
   */
  async ptzCalibrate(channel: number): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`ptzCalibrate: no camera connected to channel '${channel}'`);
    }

    const body: ReolinkJson = [
      {
        cmd: "PtzCheck",
        action: 0,
        param: {
          channel: channel
        }
      }
    ];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `ptzCalibrate failed with code ${jsonData[0]?.code || -1}`,
        "PtzCheck",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Check if auto-tracking is enabled
   * @param channel - Channel number
   * @returns true if auto-tracking is enabled
   */
  isAutoTrackingEnabled(channel: number): boolean {
    if (!this.autoTrackSettings.has(channel)) {
      return false;
    }

    const settings = this.autoTrackSettings.get(channel);
    if (settings?.bSmartTrack !== undefined) {
      return settings.bSmartTrack === 1;
    }

    return settings?.aiTrack === 1;
  }

  /**
   * Get auto-tracking disappear time
   * @param channel - Channel number
   * @returns Time in seconds before tracking stops after target disappears (-1 if not available)
   */
  getAutoTrackDisappearTime(channel: number): number {
    if (!this.autoTrackSettings.has(channel)) {
      return -1;
    }

    return this.autoTrackSettings.get(channel)?.aiDisappearBackTime ?? -1;
  }

  /**
   * Get auto-tracking stop time
   * @param channel - Channel number
   * @returns Time in seconds before camera returns to guard (-1 if not available)
   */
  getAutoTrackStopTime(channel: number): number {
    if (!this.autoTrackSettings.has(channel)) {
      return -1;
    }

    return this.autoTrackSettings.get(channel)?.aiStopBackTime ?? -1;
  }

  /**
   * Get auto-tracking method
   * @param channel - Channel number
   * @returns Tracking method value or null
   */
  getAutoTrackMethod(channel: number): number | null {
    if (!this.autoTrackSettings.has(channel)) {
      return null;
    }

    return this.autoTrackSettings.get(channel)?.aiTrack ?? null;
  }

  /**
   * Set auto-tracking settings
   * @param channel - Channel number
   * @param enable - Enable/disable tracking
   * @param disappearTime - Time before stopping after target disappears
   * @param stopTime - Time before returning to guard
   * @param method - Tracking method (from TrackMethodEnum or numeric value)
   */
  async setAutoTracking(
    channel: number,
    enable?: boolean,
    disappearTime?: number,
    stopTime?: number,
    method?: number | string
  ): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setAutoTracking: no camera connected to channel '${channel}'`);
    }

    const params: Record<string, any> = {
      channel: channel
    };

    if (enable !== undefined) {
      const settings = this.autoTrackSettings.get(channel);
      if (settings?.bSmartTrack !== undefined) {
        params.bSmartTrack = enable ? 1 : 0;
      } else {
        params.aiTrack = enable ? 1 : 0;
      }
    }

    if (disappearTime !== undefined) {
      params.aiDisappearBackTime = disappearTime;
    }

    if (stopTime !== undefined) {
      params.aiStopBackTime = stopTime;
    }

    if (method !== undefined) {
      let methodInt: number;
      if (typeof method === "string") {
        methodInt = TrackMethodEnum[method as keyof typeof TrackMethodEnum];
      } else {
        methodInt = method;
      }

      const validMethods = Object.values(TrackMethodEnum).filter(v => typeof v === "number");
      if (!validMethods.includes(methodInt)) {
        throw new InvalidParameterError(
          `setAutoTracking: method ${methodInt} not in valid methods: ${validMethods.join(', ')}`
        );
      }

      params.aiTrack = methodInt;
    }

    const body: ReolinkJson = [
      {
        cmd: "SetAiCfg",
        action: 0,
        param: params
      }
    ];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setAutoTracking failed with code ${jsonData[0]?.code || -1}`,
        "SetAiCfg",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Get auto-tracking left limit
   * @param channel - Channel number
   * @returns Left limit (0-2700, -1 if not set)
   */
  getAutoTrackLimitLeft(channel: number): number {
    if (!this.autoTrackLimits.has(channel)) {
      return -1;
    }

    return this.autoTrackLimits.get(channel)?.PtzTraceSection?.LimitLeft ?? -1;
  }

  /**
   * Get auto-tracking right limit
   * @param channel - Channel number
   * @returns Right limit (0-2700, -1 if not set)
   */
  getAutoTrackLimitRight(channel: number): number {
    if (!this.autoTrackLimits.has(channel)) {
      return -1;
    }

    return this.autoTrackLimits.get(channel)?.PtzTraceSection?.LimitRight ?? -1;
  }

  /**
   * Set auto-tracking limits
   * @param channel - Channel number
   * @param left - Left limit (0-2700, -1 to disable)
   * @param right - Right limit (0-2700, -1 to disable)
   */
  async setAutoTrackLimit(channel: number, left?: number, right?: number): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setAutoTrackLimit: no camera connected to channel '${channel}'`);
    }

    if (left === undefined && right === undefined) {
      throw new InvalidParameterError("setAutoTrackLimit: either left or right limit must be specified");
    }

    if (left !== undefined && (left < -1 || left > 2700)) {
      throw new InvalidParameterError(`setAutoTrackLimit: left limit ${left} not in range -1...2700`);
    }

    if (right !== undefined && (right < -1 || right > 2700)) {
      throw new InvalidParameterError(`setAutoTrackLimit: right limit ${right} not in range -1...2700`);
    }

    const params: Record<string, any> = {
      channel: channel
    };

    if (left !== undefined) {
      params.LimitLeft = left;
    }

    if (right !== undefined) {
      params.LimitRight = right;
    }

    const body: ReolinkJson = [
      {
        cmd: "SetPtzTraceSection",
        action: 0,
        param: {
          PtzTraceSection: params
        }
      }
    ];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setAutoTrackLimit failed with code ${jsonData[0]?.code || -1}`,
        "SetPtzTraceSection",
        jsonData[0]?.code || -1
      );
    }
  }

  // ========== Configuration Management Methods ==========

  /**
   * Get OSD settings for a channel
   * @param channel - Channel number
   * @returns OSD settings or null if not available
   */
  getOsdSettings(channel: number): OsdSettings | null {
    return this.osdSettings.get(channel) || null;
  }

  /**
   * Set OSD parameters
   * @param channel - Channel number
   * @param namePos - Position of camera name ("Off" to disable, or position string like "Upper Left")
   * @param datePos - Position of date/time ("Off" to disable, or position string)
   * @param enableWaterMark - Enable/disable watermark/logo
   */
  async setOsd(
    channel: number,
    namePos?: string,
    datePos?: string,
    enableWaterMark?: boolean
  ): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setOsd: no camera connected to channel '${channel}'`);
    }

    const osdSettings = this.osdSettings.get(channel);
    if (!osdSettings) {
      throw new NotSupportedError(`setOsd: OSD on camera ${this.cameraName(channel)} is not available`);
    }

    const body: ReolinkJson = [{ cmd: "SetOsd", action: 0, param: osdSettings }];

    if (namePos !== undefined) {
      if (namePos === "Off") {
        body[0].param.Osd.osdChannel.enable = 0;
      } else {
        body[0].param.Osd.osdChannel.enable = 1;
        body[0].param.Osd.osdChannel.pos = namePos;
      }
    }

    if (datePos !== undefined) {
      if (datePos === "Off") {
        body[0].param.Osd.osdTime.enable = 0;
      } else {
        body[0].param.Osd.osdTime.enable = 1;
        body[0].param.Osd.osdTime.pos = datePos;
      }
    }

    if (enableWaterMark !== undefined && body[0].param.Osd.watermark !== undefined) {
      body[0].param.Osd.watermark = enableWaterMark ? 1 : 0;
    }

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setOsd failed with code ${jsonData[0]?.code || -1}`,
        "SetOsd",
        jsonData[0]?.code || -1
      );
    }

    // Refresh OSD settings
    this.osdSettings.set(channel, body[0].param);
  }

  /**
   * Get recording settings for a channel
   * @param channel - Channel number
   * @returns Recording settings or null if not available
   */
  getRecordingSettings(channel: number): RecordingSettings | null {
    return this.recordingSettings.get(channel) || null;
  }

  /**
   * Set recording enable/disable
   * @param channel - Channel number
   * @param enable - Enable or disable recording
   */
  async setRecording(channel: number, enable: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setRecording: no camera connected to channel '${channel}'`);
    }

    const settings = this.recordingSettings.get(channel);
    if (!settings) {
      throw new NotSupportedError(`setRecording: recording on camera ${this.cameraName(channel)} is not available`);
    }

    const params = JSON.parse(JSON.stringify(settings)); // Deep copy
    params.Rec.scheduleEnable = enable ? 1 : 0;

    const body: ReolinkJson = [{ cmd: "SetRecV20", action: 0, param: params }];
    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setRecording failed with code ${jsonData[0]?.code || -1}`,
        "SetRecV20",
        jsonData[0]?.code || -1
      );
    }

    // Update cached settings
    this.recordingSettings.set(channel, params);
  }

  /**
   * Get motion detection alarm settings for a channel
   * @param channel - Channel number
   * @returns Motion detection settings or null if not available
   */
  getMdAlarmSettings(channel: number): MdAlarmSettings | null {
    return this.mdAlarmSettings.get(channel) || null;
  }

  /**
   * Set motion detection enable/disable
   * Note: This only works on older cameras that support the GetAlarm/SetAlarm API.
   * Newer cameras with only GetMdAlarm support use schedule-based enable/disable.
   * @param channel - Channel number
   * @param enable - Enable or disable motion detection
   */
  async setMotionDetection(channel: number, enable: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setMotionDetection: no camera connected to channel '${channel}'`);
    }

    const settings = this.mdAlarmSettings.get(channel);
    if (!settings || !settings.Alarm) {
      throw new NotSupportedError(
        `setMotionDetection: not supported on camera ${this.cameraName(channel)}. ` +
        `This camera uses the newer API which requires schedule-based configuration.`
      );
    }

    // Use SetAlarm command with Alarm parameter (older API)
    const body: ReolinkJson = [{ cmd: "SetAlarm", action: 0, param: settings }];
    
    body[0].param.Alarm.enable = enable ? 1 : 0;

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setMotionDetection failed with code ${jsonData[0]?.code || -1}`,
        "SetAlarm",
        jsonData[0]?.code || -1
      );
    }

    // Update cached settings
    this.mdAlarmSettings.set(channel, body[0].param);
  }

  /**
   * Set motion detection sensitivity
   * @param channel - Channel number
   * @param value - Sensitivity value (1-50, where 1 is least sensitive)
   */
  async setMdSensitivity(channel: number, value: number): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setMdSensitivity: no camera connected to channel '${channel}'`);
    }

    const settings = this.mdAlarmSettings.get(channel);
    if (!settings) {
      throw new NotSupportedError(`setMdSensitivity: motion detection sensitivity on camera ${this.cameraName(channel)} is not available`);
    }

    if (!Number.isInteger(value)) {
      throw new InvalidParameterError(`setMdSensitivity: sensitivity '${value}' is not an integer`);
    }

    if (value < 1 || value > 50) {
      throw new InvalidParameterError(`setMdSensitivity: sensitivity ${value} not in range 1...50`);
    }

    const body: ReolinkJson = [{
      cmd: "SetMdAlarm",
      action: 0,
      param: {
        MdAlarm: {
          channel: channel,
          useNewSens: 1,
          newSens: { sensDef: 51 - value }
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setMdSensitivity failed with code ${jsonData[0]?.code || -1}`,
        "SetMdAlarm",
        jsonData[0]?.code || -1
      );
    }

    // Refresh settings
    const refreshBody: ReolinkJson = [{ cmd: "GetMdAlarm", action: 0, param: { channel } }];
    const refreshData = await this.send(refreshBody, null, "json");
    if (refreshData[0]?.code === 0 && refreshData[0].value) {
      this.mdAlarmSettings.set(channel, refreshData[0].value);
    }
  }

  /**
   * Get AI detection alarm settings for a channel
   * @param channel - Channel number
   * @param aiType - AI detection type (person, vehicle, dog_cat, etc.)
   * @returns AI alarm settings or null if not available
   */
  getAiAlarmSettings(channel: number, aiType?: string): Map<string, any> | any | null {
    const channelSettings = this.aiAlarmSettings.get(channel);
    if (!channelSettings) {
      return null;
    }
    if (aiType) {
      return channelSettings.get(aiType) || null;
    }
    return channelSettings;
  }

  /**
   * Set AI detection sensitivity
   * @param channel - Channel number
   * @param value - Sensitivity value (0-100)
   * @param aiType - AI detection type (person, vehicle, dog_cat, etc.)
   */
  async setAiSensitivity(channel: number, value: number, aiType: string): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setAiSensitivity: no camera connected to channel '${channel}'`);
    }

    if (!Number.isInteger(value)) {
      throw new InvalidParameterError(`setAiSensitivity: sensitivity '${value}' is not an integer`);
    }

    if (value < 0 || value > 100) {
      throw new InvalidParameterError(`setAiSensitivity: sensitivity ${value} not in range 0...100`);
    }

    const body: ReolinkJson = [{
      cmd: "SetAiAlarm",
      action: 0,
      param: {
        AiAlarm: {
          channel: channel,
          ai_type: aiType,
          sensitivity: value
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setAiSensitivity failed with code ${jsonData[0]?.code || -1}`,
        "SetAiAlarm",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Set AI detection delay time
   * @param channel - Channel number
   * @param value - Delay time in seconds (0-8)
   * @param aiType - AI detection type (person, vehicle, dog_cat, etc.)
   */
  async setAiDelay(channel: number, value: number, aiType: string): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setAiDelay: no camera connected to channel '${channel}'`);
    }

    if (!Number.isInteger(value)) {
      throw new InvalidParameterError(`setAiDelay: delay '${value}' is not an integer`);
    }

    if (value < 0 || value > 8) {
      throw new InvalidParameterError(`setAiDelay: delay ${value} not in range 0...8`);
    }

    const body: ReolinkJson = [{
      cmd: "SetAiAlarm",
      action: 0,
      param: {
        AiAlarm: {
          channel: channel,
          ai_type: aiType,
          stay_time: value
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setAiDelay failed with code ${jsonData[0]?.code || -1}`,
        "SetAiAlarm",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Get FTP settings for a channel
   * @param channel - Channel number
   * @returns FTP settings or null if not available
   */
  getFtpSettings(channel: number): FtpSettings | null {
    return this.ftpSettings.get(channel) || null;
  }

  /**
   * Set FTP enable/disable
   * @param channel - Channel number
   * @param enable - Enable or disable FTP
   */
  async setFtp(channel: number, enable: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setFtp: no camera connected to channel '${channel}'`);
    }

    const body: ReolinkJson = [{
      cmd: "SetFtpV20",
      action: 0,
      param: {
        Ftp: {
          scheduleEnable: enable ? 1 : 0,
          schedule: { channel: channel }
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setFtp failed with code ${jsonData[0]?.code || -1}`,
        "SetFtpV20",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Get email settings for a channel
   * @param channel - Channel number
   * @returns Email settings or null if not available
   */
  getEmailSettings(channel: number): EmailSettings | null {
    return this.emailSettings.get(channel) || null;
  }

  /**
   * Set email notifications enable/disable
   * @param channel - Channel number
   * @param enable - Enable or disable email notifications
   */
  async setEmail(channel: number, enable: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setEmail: no camera connected to channel '${channel}'`);
    }

    const body: ReolinkJson = [{
      cmd: "SetEmailV20",
      action: 0,
      param: {
        Email: {
          scheduleEnable: enable ? 1 : 0,
          schedule: { channel: channel }
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setEmail failed with code ${jsonData[0]?.code || -1}`,
        "SetEmailV20",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Get push notification settings for a channel
   * @param channel - Channel number
   * @returns Push notification settings or null if not available
   */
  getPushSettings(channel: number): PushSettings | null {
    return this.pushSettings.get(channel) || null;
  }

  /**
   * Set push notifications enable/disable
   * @param channel - Channel number
   * @param enable - Enable or disable push notifications
   */
  async setPush(channel: number, enable: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setPush: no camera connected to channel '${channel}'`);
    }

    const body: ReolinkJson = [{
      cmd: "SetPushV20",
      action: 0,
      param: {
        Push: {
          scheduleEnable: enable ? 1 : 0,
          schedule: { channel: channel }
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setPush failed with code ${jsonData[0]?.code || -1}`,
        "SetPushV20",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Get buzzer alarm settings for a channel
   * @param channel - Channel number
   * @returns Buzzer settings or null if not available
   */
  getBuzzerSettings(channel: number): BuzzerSettings | null {
    return this.buzzerSettings.get(channel) || null;
  }

  /**
   * Set buzzer alarm enable/disable
   * @param channel - Channel number
   * @param enable - Enable or disable buzzer alarm
   */
  async setBuzzer(channel: number, enable: boolean): Promise<void> {
    if (!this.channels.includes(channel)) {
      throw new InvalidParameterError(`setBuzzer: no camera connected to channel '${channel}'`);
    }

    const body: ReolinkJson = [{
      cmd: "SetBuzzerAlarmV20",
      action: 0,
      param: {
        Buzzer: {
          scheduleEnable: enable ? 1 : 0,
          schedule: { channel: channel }
        }
      }
    }];

    const jsonData = await this.send(body, null, "json");

    if (jsonData[0]?.code !== 0) {
      throw new ApiError(
        `setBuzzer failed with code ${jsonData[0]?.code || -1}`,
        "SetBuzzerAlarmV20",
        jsonData[0]?.code || -1
      );
    }
  }

  /**
   * Get network port settings
   * @returns Network port settings or null if not available
   */
  getNetworkSettings(): NetPortSettings | null {
    return this.netportSettings;
  }

  // ========== Video Streaming Methods ==========

  /**
   * Get live stream URL based on configured protocol
   * @param channel - Channel number
   * @param stream - Stream type (main/sub/autotrack_sub/etc)
   * @param check - Whether to validate RTSP URLs (default: true)
   * @returns Stream URL or null
   */
  async getStreamSource(channel: number, stream?: string, check: boolean = true): Promise<string | null> {
    // Try login, but continue on privacy mode or login errors
    try {
      await this.login();
    } catch (err) {
      if (!(err instanceof LoginPrivacyModeError) && !(err instanceof LoginError)) {
        throw err;
      }
    }

    const streamType = stream ?? this.stream;

    // Validate stream type
    const validStreams = ["main", "sub", "ext", "autotrack_sub", "autotrack_main", "telephoto_sub", "telephoto_main"];
    if (!validStreams.includes(streamType)) {
      return null;
    }

    // Route to protocol-specific method
    if (this.protocol === "rtmp" && !this.baichuanOnly) {
      return this.getRtmpStreamSource(channel, streamType);
    }
    if ((this.protocol === "flv" || streamType === "autotrack_sub" || streamType === "telephoto_sub") && !this.baichuanOnly) {
      return this.getFlvStreamSource(channel, streamType);
    }
    if (this.protocol === "rtsp" || this.baichuanOnly) {
      return await this.getRtspStreamSource(channel, streamType, check);
    }

    return null;
  }

  /**
   * Get RTSP stream URL
   * @param channel - Channel number
   * @param stream - Stream type (defaults to this.stream)
   * @param check - Whether to validate URL (default: true)
   * @returns RTSP URL or null
   */
  async getRtspStreamSource(channel: number, stream?: string, check: boolean = true): Promise<string | null> {
    // Check if channel has streaming capability
    const validChannels = this.streamChannels.length > 0 ? this.streamChannels : this.channels;
    if (!validChannels.includes(channel)) {
      return null;
    }

    const streamType = stream ?? this.stream;

    // Map autotrack_main/telephoto_main to autotrack
    let effectiveStream = streamType;
    if (streamType === "autotrack_main" || streamType === "telephoto_main") {
      effectiveStream = "autotrack";
    }

    // Format channel as 2-digit padded (channel+1)
    const channelStr = String(channel + 1).padStart(2, '0');

    if (!this.rtspPort) {
      throw new InvalidParameterError("RTSP port not available");
    }

    // Try autotrack/baichuan format first if applicable
    if (effectiveStream === "autotrack" || this.baichuanOnly) {
      const url = `rtsp://${this.username}:${this.encPassword}@${this.host}:${this.rtspPort}/Preview_${channelStr}_${effectiveStream}`;
      return url;
    }

    // Get encoding for the stream
    const encoding = await this.getEncoding(channel, effectiveStream);

    // Try encoding-specific URL
    const url = `rtsp://${this.username}:${this.encPassword}@${this.host}:${this.rtspPort}/${encoding}Preview_${channelStr}_${effectiveStream}`;
    
    // For now, return the URL without validation
    // Full RTSP validation would require an RTSP client library
    return url;
  }

  /**
   * Get RTMP stream URL
   * @param channel - Channel number
   * @param stream - Stream type (defaults to this.stream)
   * @returns RTMP URL or null
   */
  getRtmpStreamSource(channel: number, stream?: string): string | null {
    // Check if channel has streaming capability
    const validChannels = this.streamChannels.length > 0 ? this.streamChannels : this.channels;
    if (!validChannels.includes(channel)) {
      return null;
    }

    if (!this.rtmpPort) {
      return null;
    }

    const streamType = stream ?? this.stream;

    // Determine stream type number
    let streamTypeNum: number;
    if (streamType === "sub" || streamType === "autotrack_sub" || streamType === "telephoto_sub") {
      streamTypeNum = 1;
    } else {
      streamTypeNum = 0;
    }

    // Build URL based on authentication method
    if (this.rtmpAuthMethod === DEFAULT_RTMP_AUTH_METHOD) {
      // Password authentication (uses unencoded password)
      return `rtmp://${this.host}:${this.rtmpPort}/bcs/channel${channel}_${streamType}.bcs?channel=${channel}&stream=${streamTypeNum}&user=${this.username}&password=${this.password}`;
    } else {
      // Token authentication
      return `rtmp://${this.host}:${this.rtmpPort}/bcs/channel${channel}_${streamType}.bcs?channel=${channel}&stream=${streamTypeNum}&token=${this.token}`;
    }
  }

  /**
   * Get FLV stream URL
   * @param channel - Channel number
   * @param stream - Stream type (defaults to this.stream)
   * @returns FLV URL or null
   */
  getFlvStreamSource(channel: number, stream?: string): string | null {
    // Check if channel has streaming capability
    const validChannels = this.streamChannels.length > 0 ? this.streamChannels : this.channels;
    if (!validChannels.includes(channel)) {
      return null;
    }

    if (!this.rtmpPort) {
      return null;
    }

    const streamType = stream ?? this.stream;

    const protocol = this.useHttps === false ? "http" : this.useHttps === true ? "https" : "http";
    const port = this.port ?? (this.useHttps ? 443 : 80);

    // FLV uses unencoded password
    return `${protocol}://${this.host}:${port}/flv?port=${this.rtmpPort}&app=bcs&stream=channel${channel}_${streamType}.bcs&user=${this.username}&password=${this.password}`;
  }

  /**
   * Get encoding type for a stream
   * @param channel - Channel number
   * @param stream - Stream type (default: "main")
   * @returns Encoding type ("h264" or "h265")
   */
  async getEncoding(channel: number, stream: string = "main"): Promise<string> {
    // Fetch encoding settings if not cached
    // Note: GetEnc is fetched via getChannelData, so this should already be populated
    // If not, we'll use fallback values
    return this.encoding(channel, stream);
  }

  /**
   * Get cached encoding type for a stream
   * @param channel - Channel number
   * @param stream - Stream type (default: "main")
   * @returns Encoding type ("h264" or "h265")
   */
  encoding(channel: number, stream: string = "main"): string {
    const channelSettings = this.encSettings.get(channel);
    if (channelSettings) {
      const streamKey = `${stream}Stream`;
      const vType = (channelSettings as any)[streamKey]?.vType;
      if (vType) {
        return vType;
      }
    }

    // Fallback logic
    if (stream === "sub") {
      return "h264";
    }

    // Check if main stream supports h265
    // This would require API version checking which we'll implement later
    // For now, default to h264
    return "h264";
  }

  /**
   * Get snapshot/still image from camera
   * @param channel - Channel number
   * @param stream - Stream type (default: "main")
   * @returns JPEG image data or null
   */
  async getSnapshot(channel: number, stream?: string): Promise<Buffer | null> {
    // Check if channel has streaming capability
    const validChannels = this.streamChannels.length > 0 ? this.streamChannels : this.channels;
    if (!validChannels.includes(channel)) {
      return null;
    }

    let streamType = stream ?? "main";

    // Check privacy mode - baichuan has a privacyModeMap property
    // For now, skip privacy mode check as we don't have direct access
    // TODO: Add proper privacy mode checking via baichuan

    // Build parameters
    const param: Record<string, any> = {
      cmd: "Snap",
      channel: channel
    };

    // Handle special stream types
    if (streamType.startsWith("autotrack_") || streamType.startsWith("telephoto_")) {
      param.iLogicChannel = 1;
      streamType = streamType.replace(/^autotrack_/, "").replace(/^telephoto_/, "");
    }

    if (streamType.startsWith("snapshots_")) {
      streamType = streamType.replace(/^snapshots_/, "");
    }

    // Validate stream type
    if (streamType !== "main" && streamType !== "sub") {
      streamType = "main";
    }

    param.snapType = streamType;

    // For sub stream, include dimensions if available
    if (streamType === "sub") {
      const channelSettings = this.encSettings.get(channel);
      if (channelSettings) {
        const subStream = (channelSettings as any).subStream;
        if (subStream?.height && subStream?.width) {
          param.width = subStream.width;
          param.height = subStream.height;
        }
      }
    }

    try {
      const response = await this.send([{}], param, "image/jpeg");
      
      if (!response || (response as Buffer).length === 0) {
        debugLog(`Error obtaining still image response for channel ${channel}`);
        return null;
      }

      return response as Buffer;
    } catch (err) {
      debugLog(`Error getting snapshot: ${err}`);
      return null;
    }
  }

  /**
   * Get the cached host data as a JSON string
   * Similar to Python's get_raw_host_data() method
   */
  getRawHostData(): string {
    const data: Record<string, any> = {};
    this.hostDataRaw.forEach((value, key) => {
      data[key] = value;
    });
    return JSON.stringify(data);
  }

  /**
   * Set the cached host data from a JSON string
   * Similar to Python's set_raw_host_data() method
   */
  setRawHostData(data: string): void {
    const parsed = JSON.parse(data);
    this.hostDataRaw.clear();
    Object.keys(parsed).forEach((key) => {
      this.hostDataRaw.set(key, parsed[key]);
    });
  }

  /**
   * Enable or disable response caching
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) {
      this.clearCache();
    }
  }

  /**
   * Set cache time-to-live in milliseconds
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
  }

  /**
   * Clear the response cache
   */
  clearCache(): void {
    this.responseCache.clear();
  }

  /**
   * Clear expired cache entries
   */
  private clearExpiredCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    this.responseCache.forEach((value, key) => {
      if (now - value.timestamp > this.cacheTTL) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.responseCache.delete(key));
  }

  /**
   * Generate cache key from request
   */
  private getCacheKey(body: ReolinkJson, param: Record<string, any> | null): string {
    // Create deterministic key from body and params
    const bodyKey = JSON.stringify(body);
    const paramKey = param ? JSON.stringify(param) : '';
    return `${bodyKey}:${paramKey}`;
  }

  // Subscription methods (simplified)
  async subscribe(webhookUrl: string): Promise<void> {
    throw new NotSupportedError("subscribe not yet implemented");
  }

  renewTimer(): number {
    return 0;
  }

  async renew(): Promise<void> {
    throw new NotSupportedError("renew not yet implemented");
  }

  // Expose private properties for Baichuan integration
  get _isNvr(): boolean {
    return this.isNvr;
  }

  set _isNvr(value: boolean) {
    this.isNvr = value;
  }

  get _isHub(): boolean {
    return this.isHub;
  }

  set _isHub(value: boolean) {
    this.isHub = value;
  }

  // Expose perimeter map to Baichuan for updates
  get _perimeterDetectionStates(): Map<number, Map<string, Set<number>>> {
    return this.perimeterDetectionStates;
  }

  get _numChannels(): number {
    return this.numChannels;
  }

  set _numChannels(value: number) {
    this.numChannels = value;
  }

  get _channels(): Array<number> {
    return this.channels;
  }

  set _channels(value: Array<number>) {
    this.channels = value;
  }

  get _streamChannels(): Array<number> {
    return this.streamChannels;
  }

  set _streamChannels(value: Array<number>) {
    this.streamChannels = value;
  }

  get _motionDetectionStates(): Map<number, boolean> {
    return this.motionDetectionStates;
  }

  get _visitorStates(): Map<number, boolean> {
    return this.visitorStates;
  }

  get _aiDetectionStates(): Map<number, Map<string, boolean>> {
    return this.aiDetectionStates;
  }

  get _updating(): boolean {
    return false;
  }

  /**
   * Request VOD files for a specific channel and time range
   */
  async requestVodFiles(
    channel: number,
    start: Date,
    end: Date,
    statusOnly: boolean = false,
    stream?: string,
    splitTime?: number, // milliseconds
    trigger?: any // VODTrigger - not implemented yet
  ): Promise<[VODSearchStatus[], VODFile[]]> {
    // Use channels if streamChannels is empty (for standalone cameras)
    const validChannels = this.streamChannels.length > 0 ? this.streamChannels : this.channels;
    if (!validChannels.includes(channel)) {
      throw new InvalidParameterError(`Request VOD files: no camera connected to channel '${channel}'`);
    }
    if (start > end) {
      throw new InvalidParameterError(`Request VOD files: start date '${start}' needs to be before end date '${end}'`);
    }

    if (!stream) {
      stream = this.stream;
    }

    // Build search body
    const body: ReolinkJson = [];
    const searchBody: ReolinkJson[0] = {
      cmd: "Search",
      action: 0,
      param: {
        Search: {
          channel: channel,
          onlyStatus: statusOnly ? 1 : 0,
          streamType: stream,
          StartTime: datetimeToReolinkTime(start),
          EndTime: datetimeToReolinkTime(end)
        }
      }
    };
    body.push(searchBody);

    try {
      const jsonData = await this.send(body, { cmd: "Search" }, "json");
      
      const statuses: VODSearchStatus[] = [];
      const vodFiles: VODFile[] = [];

      for (const data of jsonData) {
        if (data.code !== 0) {
          throw new ApiError(
            `Host: ${this.host}:${this.port}: Request VOD files: API returned error code ${data.code || -1}`,
            "",
            data.code || -1
          );
        }

        const searchResult = data.value?.SearchResult;
        if (!searchResult) {
          continue;
        }

        // Parse statuses
        if (searchResult.Status && Array.isArray(searchResult.Status)) {
          for (const status of searchResult.Status) {
            statuses.push(new VODSearchStatus(status));
          }
        }

        if (statusOnly) {
          continue;
        }

        // Parse files
        if (searchResult.File && Array.isArray(searchResult.File)) {
          for (const file of searchResult.File) {
            vodFiles.push(new VODFile(file));
          }
        }
      }

      // Sort files by start time (newest first)
      vodFiles.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

      return [statuses, vodFiles];
    } catch (err) {
      if (err instanceof InvalidContentTypeError) {
        throw new InvalidContentTypeError(`Request VOD files error: ${err.message}`);
      }
      if (err instanceof NoDataError) {
        throw new NoDataError(`Request VOD files error: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Prepare NVR download by calling NvrDownload command
   * Returns the filename to use for the Download command
   */
  private async prepareNvrDownload(
    startTime: Date,
    endTime: Date,
    channel: number,
    stream: string
  ): Promise<string> {
    // Convert dates to Reolink time object format
    const dateToReolinkTime = (d: Date) => ({
      year: d.getFullYear(),
      mon: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      min: d.getMinutes(),
      sec: d.getSeconds(),
    });

    const start = dateToReolinkTime(startTime);
    const end = dateToReolinkTime(endTime);
    
    let iLogicChannel = 0;
    let streamType = stream;
    if (stream.startsWith('autotrack_') || stream.startsWith('telephoto_')) {
      iLogicChannel = 1;
      streamType = stream.replace('autotrack_', '').replace('telephoto_', '');
    }

    const body = [
      {
        cmd: 'NvrDownload',
        action: 1,
        param: {
          NvrDownload: {
            channel: channel,
            iLogicChannel: iLogicChannel,
            streamType: streamType,
            StartTime: start,
            EndTime: end,
          },
        },
      },
    ];

    const jsonData = await this.send(body);

    if (jsonData[0].code !== 0) {
      throw new ApiError(
        `NvrDownload failed with code ${jsonData[0].code}`,
        'NvrDownload',
        jsonData[0].code
      );
    }

    // Find largest file from the list
    const fileList = jsonData[0].value.fileList;
    if (!fileList || fileList.length === 0) {
      throw new NoDataError('NvrDownload returned no files');
    }

    let maxFilesize = 0;
    let filename = '';
    for (const file of fileList) {
      const filesize = parseInt(file.fileSize, 10);
      if (filesize > maxFilesize) {
        maxFilesize = filesize;
        filename = file.fileName;
      }
    }

    return filename;
  }

  /**
   * Download a VOD file to memory
   * For NVRs, this uses the two-step process: NvrDownload then Download
   */
  async downloadVod(
    channel: number,
    startTime: Date,
    endTime: Date,
    stream: string = 'sub'
  ): Promise<{ data: ArrayBuffer; filename: string }> {
    // Ensure logged in
    await this.login();

    let filename: string;
    
    // For NVRs, prepare the download first
    if (this.isNvr) {
      filename = await this.prepareNvrDownload(startTime, endTime, channel, stream);
    } else {
      throw new InvalidParameterError('downloadVod: currently only supported for NVRs');
    }

    // Now download using the prepared filename
    const param = {
      cmd: 'Download',
      source: filename,
      output: filename.replace(/\//g, '_'),
      token: this.token,
    };

    // Make the download request using GET with query parameters (not POST)
    const url = `${this.url}/api.cgi`;
    const response = await this.httpClient.get(url, {
      params: param,
      responseType: 'arraybuffer',
    });

    if (response.status >= 400) {
      throw new ApiError(`Download failed with HTTP ${response.status}`, 'Download', response.status);
    }

    return {
      data: response.data,
      filename: param.output,
    };
  }

  /**
   * Get VOD source URL for playback or download
   */
  async getVodSource(
    channel: number,
    filename: string,
    stream?: string,
    requestType: VodRequestType = VodRequestType.FLV
  ): Promise<[string, string]> {
    // Use channels if streamChannels is empty (for standalone cameras)
    const validChannels = this.streamChannels.length > 0 ? this.streamChannels : this.channels;
    if (!validChannels.includes(channel)) {
      throw new InvalidParameterError(`get_vod_source: no camera connected to channel '${channel}'`);
    }

    // Ensure logged in
    await this.login();

    if (!stream) {
      stream = this.stream;
    }

    // Determine stream type
    let streamType = 0;
    if (stream === "sub") {
      streamType = 1;
    } else if (stream === "autotrack_sub" || stream === "telephoto_sub") {
      streamType = 3;
    } else if (stream === "autotrack_main" || stream === "telephoto_main") {
      streamType = 2;
    }

    // Determine credentials and mime type
    let mime: string;
    let credentials: string;
    if (requestType === VodRequestType.FLV || requestType === VodRequestType.RTMP || requestType === VodRequestType.DOWNLOAD) {
      mime = requestType === VodRequestType.DOWNLOAD ? "video/mp4" : "application/x-mpegURL";
      credentials = `&user=${this.username}&password=${this.password}`;
    } else {
      mime = "video/mp4";
      credentials = `&token=${this.token}`;
    }

    // Build URL based on request type
    let url: string;
    const protocol = this.useHttps === false ? "http" : this.useHttps === true ? "https" : "http";
    const port = this.port ? `:${this.port}` : "";

    if (requestType === VodRequestType.RTMP) {
      if (!this.rtmpPort) {
        throw new InvalidParameterError("RTMP port not available");
      }
      url = `rtmp://${this.host}:${this.rtmpPort}/vod/${filename.replace(/\//g, "%20")}?channel=${channel}&stream=${streamType}`;
    } else if (requestType === VodRequestType.FLV) {
      if (!this.rtmpPort) {
        throw new InvalidParameterError("RTMP port not available");
      }
      url = `${protocol}://${this.host}${port}/flv?port=${this.rtmpPort}&app=bcs&stream=playback.bcs&channel=${channel}&type=${streamType}&start=${filename}&seek=0`;
    } else if (requestType === VodRequestType.PLAYBACK || requestType === VodRequestType.DOWNLOAD) {
      // Extract time from filename for start parameter
      const match = filename.match(/.*Rec\w{3}(?:_|_DST)(\d{8})_(\d{6})_.*/);
      let timeStart = "";
      let startTime = "";
      if (match) {
        timeStart = `${match[1]}${match[2]}`;
        startTime = `&start=${timeStart}`;
      }
      const cmd = requestType;
      url = `${protocol}://${this.host}${port}?cmd=${cmd}&channel=${channel}&source=${filename.replace(/ /g, "%20")}&output=ha_playback_${timeStart}.mp4${startTime}`;
    } else {
      throw new InvalidParameterError(`get_vod_source: unsupported request_type '${requestType}'`);
    }

    return [mime, `${url}${credentials}`];
  }
}
