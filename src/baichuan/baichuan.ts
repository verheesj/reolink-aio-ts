import { connect, Socket } from "node:net";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { Host } from "../api/host";
import {
  ApiError,
  CredentialsInvalidError,
  InvalidContentTypeError,
  InvalidParameterError,
  NotSupportedError,
  ReolinkConnectionError,
  ReolinkError,
  ReolinkTimeoutError,
  UnexpectedDataError
} from "../exceptions";
import { AI_DETECT_CONVERSION, MAX_COLOR_TEMP, MIN_COLOR_TEMP, UNKNOWN } from "../constants";
import { BaichuanTcpClientProtocol } from "./tcp-protocol";
import {
  AES_IV,
  DEFAULT_BC_PORT,
  EncType,
  PortType,
  decryptBaichuan,
  encryptBaichuan,
  md5StrModern
} from "./util";
import * as xmls from "./xmls";

const DEBUG_ENABLED = Boolean(process?.env?.REOLINK_AIO_DEBUG);

function debugLog(message: string, ...args: Array<unknown>): void {
  if (DEBUG_ENABLED) {
    // eslint-disable-next-line no-console
    console.debug(`[reolink-aio][baichuan] ${message}`, ...args);
  }
}

const RETRY_ATTEMPTS = 3;
const KEEP_ALIVE_INTERVAL = 30; // seconds
const MIN_KEEP_ALIVE_INTERVAL = 9; // seconds
const TIMEOUT = 30; // seconds

const AI_DETECTS = new Set<string>(["people", "vehicle", "dog_cat", "state"]);
const SMART_AI: Record<string, [number, number]> = {
  crossline: [527, 528],
  intrusion: [529, 530],
  loitering: [531, 532],
  legacy: [549, 550],
  loss: [551, 552]
};

type CallbackFunction = () => void;
type CmdListType = Record<string, Record<string, number>> | Record<string, Array<number>> | null;

/**
 * Reolink Baichuan API class
 */
export class Baichuan {
  readonly httpApi: Host;
  readonly port: number;

  private readonly host: string;
  private readonly username: string;
  private readonly password: string;
  private nonce: string | null = null;
  private userHash: string | null = null;
  private passwordHash: string | null = null;
  private aesKey: Buffer | null = null;
  private logOnce: Set<string> = new Set();
  private logError: boolean = true;
  public lastPrivacyCheck: number = 0;
  public lastPrivacyOn: number = 0;

  // TCP connection
  private mutex: Promise<void> = Promise.resolve();
  private loginMutex: Promise<void> = Promise.resolve();
  private transport: Socket | null = null;
  private protocol: BaichuanTcpClientProtocol | null = null;
  private loggedIn: boolean = false;

  // Event subscription
  private subscribed: boolean = false;
  private eventsActive: boolean = false;
  private keepaliveTask: NodeJS.Timeout | null = null;
  private keepaliveInterval: number = KEEP_ALIVE_INTERVAL;
  private timeKeepaliveLoop: number = 0;
  private timeReestablish: number = 0;
  private timeKeepaliveIncrease: number = 0;
  private timeConnectionLost: number = 0;
  private extCallback: Map<number | null, Map<number | null, Map<string, CallbackFunction>>> = new Map();

  // http_cmd functions
  public cmdFuncs: Map<string, (...args: any[]) => Promise<any>> = new Map();

  // supported
  public capabilities: Map<number | null, Set<string>> = new Map();
  private abilities: Map<number | null, any> = new Map();

  // host states
  private ports: Map<string, Map<string, number | boolean>> = new Map();
  private scenes: Map<number, string> = new Map();
  private activeScene: number = -1;
  private dayNightState: Map<number, string> = new Map();
  private devType: string = "";

  // channel states
  private devInfo: Map<number | null, Map<string, string>> = new Map();
  private networkInfo: Map<number | null, Map<string, string>> = new Map();
  private wifiConnection: Map<number, boolean> = new Map();
  private ptzPosition: Map<number, Map<string, string>> = new Map();
  private privacyMode: Map<number, boolean> = new Map();
  private aiDetect: Map<number, Map<string, Map<number, Map<string, any>>>> = new Map();
  private hardwiredChimeSettings: Map<number, Map<string, string | number>> = new Map();
  private irBrightness: Map<number, number> = new Map();
  private crySensitivity: Map<number, number> = new Map();
  private preRecordState: Map<number, Map<string, any>> = new Map();
  private sirenState: Map<number, boolean> = new Map();
  private noiseReduction: Map<number, number> = new Map();
  private aiYolo600: Map<number, Map<string, boolean>> = new Map();
  private aiYolo696: Map<number, Map<string, boolean>> = new Map();
  private aiYoloSubType: Map<number, Map<string, string | null>> = new Map();
  private ruleIds: Set<number> = new Set();
  private rules: Map<number, Map<number, Map<string, any>>> = new Map();
  private ioInputs: Map<number | null, Array<number>> = new Map();
  private ioOutputs: Map<number | null, Array<number>> = new Map();
  private ioInput: Map<number | null, Map<number, boolean>> = new Map();

  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "_text",
    parseTagValue: true,
    trimValues: true
  });

  constructor(host: string, username: string, password: string, httpApi: Host, port: number = DEFAULT_BC_PORT) {
    this.httpApi = httpApi;
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;

    // Register http_cmd decorated methods
    this.registerCmdFuncs();
  }

  private registerCmdFuncs(): void {
    // This will be populated by methods decorated with @httpCmd
    // For now, we'll manually register methods that have http_cmds
    // In a full implementation, we'd use decorators or metadata
  }

  /**
   * Initialize the protocol and make the connection if needed
   */
  private async connectIfNeeded(): Promise<void> {
    if (this.transport && this.protocol && !this.transport.destroyed) {
      return; // connection is open
    }

    if (this.protocol) {
      // Wait for previous receive futures to finish
      debugLog(`Baichuan host ${this.host}: waiting for previous receive futures to finish before opening a new connection`);
      try {
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, (TIMEOUT + 5) * 1000)),
          new Promise((resolve) => {
            // Wait for protocol to be ready
            const check = setInterval(() => {
              if (!this.protocol) {
                clearInterval(check);
                resolve(undefined);
              }
            }, 10);
          })
        ]);
      } catch {
        debugLog(`Baichuan host ${this.host}: Previous receive futures did not finish before opening a new connection`);
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ReolinkConnectionError(`Baichuan host ${this.host}: Connection timeout`));
      }, TIMEOUT * 1000);

      const socket = new Socket();
      const protocol = new BaichuanTcpClientProtocol(this.host, this.pushCallback.bind(this), this.closeCallback.bind(this));

      const errorHandler = (error: Error) => {
        clearTimeout(timeout);
        reject(new ReolinkConnectionError(`Baichuan host ${this.host}: Connection error: ${error.message}`));
      };

      socket.once("connect", () => {
        clearTimeout(timeout);
        // Remove the initial error handler since protocol will handle errors now
        socket.removeListener("error", errorHandler);
        protocol.connect(socket);
        this.transport = socket;
        this.protocol = protocol;
        resolve();
      });

      socket.once("error", errorHandler);

      socket.connect(this.port, this.host);
    });
  }

  /**
   * Generic baichuan send method
   */
  async send(
    cmdId: number,
    channel: number | null = null,
    body: string = "",
    extension: string = "",
    encType: EncType = EncType.AES,
    messageClass: string = "1464",
    messId: number | null = null,
    retry: number = RETRY_ATTEMPTS
  ): Promise<string> {
    retry = retry - 1;

    if (!this.loggedIn && cmdId > 2) {
      // not logged in and requesting a non login/logout cmd, first login
      await this.login();
    }

    // mess_id: 0/251 = push, 1-100 = channel, 250 = host
    if (messId === null) {
      if (channel === null) {
        messId = 250;
      } else {
        messId = channel + 1;
      }
    }

    let ext = extension; // do not overwrite the original arguments for retries
    if (channel !== null) {
      if (extension) {
        throw new InvalidParameterError(`Baichuan host ${this.host}: cannot specify both channel and extension`);
      }
      ext = xmls.buildChannelExtensionXml({ channel });
    }

    const messLen = ext.length + body.length;
    const payloadOffset = ext.length;

    const cmdIdBytes = Buffer.allocUnsafe(4);
    cmdIdBytes.writeUInt32LE(cmdId, 0);
    const messLenBytes = Buffer.allocUnsafe(4);
    messLenBytes.writeUInt32LE(messLen, 0);
    const messIdBytes = Buffer.allocUnsafe(4);
    messIdBytes.writeUInt32LE(messId, 0);
    const payloadOffsetBytes = Buffer.allocUnsafe(4);
    payloadOffsetBytes.writeUInt32LE(payloadOffset, 0);

    let header: Buffer;
    if (messageClass === "1465") {
      const encrypt = Buffer.from("12dc", "hex");
      header = Buffer.concat([
        Buffer.from("f0debc0a", "hex"),
        cmdIdBytes,
        messLenBytes,
        messIdBytes,
        encrypt,
        Buffer.from(messageClass, "hex")
      ]);
    } else if (messageClass === "1464") {
      const statusCode = Buffer.from("0000", "hex");
      header = Buffer.concat([
        Buffer.from("f0debc0a", "hex"),
        cmdIdBytes,
        messLenBytes,
        messIdBytes,
        statusCode,
        Buffer.from(messageClass, "hex"),
        payloadOffsetBytes
      ]);
    } else {
      throw new InvalidParameterError(`Baichuan host ${this.host}: invalid param message_class '${messageClass}'`);
    }

    let encBodyBytes = Buffer.alloc(0);
    if (messLen > 0) {
      if (encType === EncType.BC) {
        encBodyBytes = Buffer.concat([encryptBaichuan(ext, messId), encryptBaichuan(body, messId)]);
      } else if (encType === EncType.AES) {
        encBodyBytes = Buffer.concat([this.aesEncrypt(ext), this.aesEncrypt(body)]);
      } else {
        throw new InvalidParameterError(`Baichuan host ${this.host}: invalid param enc_type '${encType}'`);
      }
    }

    // send message
    await this.connectIfNeeded();
    if (!this.protocol || !this.transport) {
      throw new ReolinkConnectionError(`Baichuan host ${this.host}: Protocol not initialized`);
    }

    // Check for simultaneous cmd_ids with same mess_id
    const existingFuture = this.protocol["receiveFutures"]?.get(cmdId)?.get(messId);
    if (existingFuture) {
      debugLog(`Baichuan host ${this.host}: waiting for existing future for cmd_id ${cmdId}, mess_id ${messId}`);
      try {
        await Promise.race([
          existingFuture.promise,
          new Promise((resolve) => setTimeout(resolve, TIMEOUT * 1000))
        ]);
        // Wait a bit more for cleanup
        let waitCount = 0;
        while (this.protocol["receiveFutures"]?.get(cmdId)?.get(messId) && waitCount < 1000) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          waitCount++;
        }
        if (waitCount >= 1000) {
          debugLog(`Baichuan host ${this.host}: timeout waiting for cleanup of cmd_id ${cmdId}, mess_id ${messId}`);
        }
      } catch (err) {
        debugLog(`Baichuan host ${this.host}: error or timeout waiting for existing future: ${err}`);
        // Timeout or error, continue
      }
    }

    debugLog(`Baichuan host ${this.host}: creating new future for cmd_id ${cmdId}, mess_id ${messId}`);
    const responsePromise = this.protocol.waitForResponse(cmdId, messId, TIMEOUT * 1000);

    if (debugLog) {
      if (messLen > 0) {
        debugLog(`Baichuan host ${this.host}: writing cmd_id ${cmdId}, body:\n${this.hidePassword(ext + body)}`);
        debugLog(`Baichuan host ${this.host}: BODY DETAILS: ext.length=${ext.length}, body.length=${body.length}, messLen=${messLen}, payloadOffset=${payloadOffset}`);
      } else {
        debugLog(`Baichuan host ${this.host}: writing cmd_id ${cmdId}, without body`);
      }
    }

    let retrying = false;
    let data: Buffer = Buffer.alloc(0);
    let lenHeader: number = 0;
    try {
      // Acquire mutex
      await this.mutex;
      this.mutex = new Promise((resolve) => {
        setTimeout(() => resolve(), 0);
      });

      const fullData = Buffer.concat([header, encBodyBytes]);
      debugLog(`Baichuan host ${this.host}: writing to socket for cmd_id ${cmdId}, mess_id ${messId}, data length ${fullData.length}`);
      debugLog(`Baichuan host ${this.host}: HEX DUMP header (${header.length} bytes): ${header.toString('hex')}`);
      if (encBodyBytes.length > 0 && encBodyBytes.length <= 500) {
        debugLog(`Baichuan host ${this.host}: HEX DUMP encrypted body (${encBodyBytes.length} bytes): ${encBodyBytes.toString('hex')}`);
      }
      this.transport.write(fullData);
      [data, lenHeader] = await responsePromise;
      debugLog(`Baichuan host ${this.host}: received response for cmd_id ${cmdId}, mess_id ${messId}`);
    } catch (err: any) {
      if (err instanceof ApiError && err.rspCode === 400 && retry > 0) {
        debugLog(`${err.message}, trying again in 1.5 s`);
        await new Promise((resolve) => setTimeout(resolve, 1500)); // give the battery cam time to wake
        retrying = true;
      } else if (err instanceof ReolinkTimeoutError && retry > 0 && cmdId !== 2) {
        const chStr = channel !== null ? `, ch ${channel}` : "";
        debugLog(`Baichuan host ${this.host}: Timeout error for cmd_id ${cmdId}${chStr}, trying again`);
        retrying = true;
      } else if ((err instanceof Error && err.message.includes("Connection")) && retry > 0 && cmdId !== 2) {
        const chStr = channel !== null ? `, ch ${channel}` : "";
        debugLog(`Baichuan host ${this.host}: Connection error during read/write of cmd_id ${cmdId}${chStr}: ${err.message}, trying again`);
        retrying = true;
      } else {
        throw err;
      }
    }

    if (retrying) {
      // needed because the receive_future first needs to be cleared.
      return await this.send(cmdId, channel, body, extension, encType, messageClass, messId, retry);
    }

    // decryption
    const recBody = this.decrypt(data, lenHeader, cmdId, encType);

    if (debugLog) {
      const chStr = channel !== null ? ` ch ${channel}` : "";
      if (recBody.length > 0) {
        debugLog(`Baichuan host ${this.host}: received cmd_id ${cmdId}${chStr}:\n${this.hidePassword(recBody)}`);
      } else {
        debugLog(`Baichuan host ${this.host}: received cmd_id ${cmdId}${chStr} status 200:OK without body`);
      }
    }

    return recBody;
  }

  private aesEncrypt(body: string): Buffer {
    if (!body) {
      return Buffer.alloc(0);
    }
    if (!this.aesKey) {
      throw new InvalidParameterError(`Baichuan host ${this.host}: first login before using AES encryption`);
    }

    const cipher = createCipheriv("aes-128-cfb", this.aesKey, AES_IV);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  }

  private aesDecrypt(data: Buffer, header: Buffer = Buffer.alloc(0)): string {
    if (!this.aesKey) {
      throw new InvalidParameterError(`Baichuan host ${this.host}: first login before using AES decryption, header: ${header.toString("hex")}`);
    }

    const decipher = createDecipheriv("aes-128-cfb", this.aesKey, AES_IV);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }

  private decrypt(data: Buffer, lenHeader: number, cmdId: number, encType: EncType = EncType.AES): string {
    const recEncOffset = data.readUInt32LE(12); // mess_id = enc_offset
    const recEncType = data.slice(16, 18).toString("hex");
    const encBody = data.slice(lenHeader);
    const header = data.slice(0, lenHeader);

    if (debugLog) {
      debugLog(`Baichuan host ${this.host}: decrypt cmd_id ${cmdId}, lenHeader=${lenHeader}, encBody.length=${encBody.length}, recEncType=${recEncType}, header=${header.toString('hex')}, hasAesKey=${!!this.aesKey}`);
    }

    let recBody = "";
    if (encBody.length === 0) {
      return recBody;
    }

    // For 24-byte headers, recEncType at position 16-18 is actually the status code, not encryption type
    // We need to determine encryption based on context
    const is24ByteHeader = lenHeader === 24;
    
    // decryption
    if ((lenHeader === 20 && (recEncType === "01dd" || recEncType === "12dd")) || encType === EncType.BC) {
      // Baichuan Encryption
      recBody = decryptBaichuan(encBody, recEncOffset);
    } else if (
      (lenHeader === 20 && (recEncType === "02dd" || recEncType === "03dd")) ||
      (is24ByteHeader && this.aesKey)
    ) {
      // AES Encryption - only try if we have an AES key
      try {
        recBody = this.aesDecrypt(encBody, header);
        if (!recBody.startsWith("<?xml")) {
          // AES decryption didn't work, try Baichuan
          debugLog(`Baichuan host ${this.host}: AES decryption didn't produce valid XML, trying Baichuan decryption`);
          recBody = decryptBaichuan(encBody, recEncOffset);
        }
      } catch (err) {
        debugLog(`Baichuan host ${this.host}: AES decryption failed for cmd_id ${cmdId} with error: ${err}, trying Baichuan decryption`);
        recBody = decryptBaichuan(encBody, recEncOffset);
      }
    } else if (recEncType === "00dd" || is24ByteHeader) {
      // Unencrypted or 24-byte header without AES key - try Baichuan first, then plaintext
      try {
        recBody = decryptBaichuan(encBody, recEncOffset);
        if (!recBody.startsWith("<?xml")) {
          // Baichuan didn't work, try plaintext
          recBody = encBody.toString("utf8");
        }
      } catch {
        // Try plaintext
        recBody = encBody.toString("utf8");
      }
    } else {
      // Unknown encryption type
      throw new InvalidContentTypeError(
        `Baichuan host ${this.host}: received unknown encryption type '${recEncType}', data: ${data.toString("hex")}`
      );
    }

    // Final validation - check if decryption succeeded
    if (!recBody.startsWith("<?xml")) {
      // Try alternative decryption methods
      if (recEncType === "00dd") {
        recBody = encBody.toString("utf8");
      }
      if (!recBody.startsWith("<?xml")) {
        recBody = decryptBaichuan(encBody, recEncOffset);
      }
      if (!recBody.startsWith("<?xml")) {
        throw new UnexpectedDataError(
          `Baichuan host ${this.host}: unable to decrypt message with cmd_id ${cmdId}, ` +
            `header '${header.toString("hex")}', decrypted data startswith '${recBody.slice(0, 5)}', ` +
            `encrypted data startswith '${encBody.slice(0, 5).toString("hex")}' instead of '<?xml'`
        );
      }
    }

    return recBody;
  }

  private hidePassword(content: string | Buffer | Record<string, any> | Array<any>): string {
    let redacted = String(content);
    if (this.password) {
      redacted = redacted.replace(new RegExp(this.password, "g"), "<password>");
    }
    if (this.nonce) {
      redacted = redacted.replace(new RegExp(this.nonce, "g"), "<nonce>");
    }
    if (this.userHash) {
      redacted = redacted.replace(new RegExp(this.userHash, "g"), "<user_md5_hash>");
    }
    if (this.passwordHash) {
      redacted = redacted.replace(new RegExp(this.passwordHash, "g"), "<password_md5_hash>");
    }
    return redacted;
  }

  private pushCallback(cmdId: number, data: Buffer, lenHeader: number): void {
    // Callback to parse a received message that was pushed
    try {
      const recBody = this.decrypt(data, lenHeader, cmdId);
      if (recBody.length === 0) {
        debugLog(`Baichuan host ${this.host}: received push cmd_id ${cmdId} without body`);
        return;
      }

      if (debugLog) {
        debugLog(`Baichuan host ${this.host}: received push cmd_id ${cmdId}:\n${this.hidePassword(recBody)}`);
      }

      this.parseXml(cmdId, recBody);
    } catch (err) {
      if (err instanceof ReolinkError) {
        debugLog(String(err));
      }
    }
  }

  private closeCallback(): void {
    // Callback for when the connection is closed
    this.loggedIn = false;
    const eventsActive = this.eventsActive;
    this.eventsActive = false;
    if (this.subscribed) {
      const now = Date.now() / 1000;
      if (!eventsActive) {
        // There was no proper connection, or close_callback is being called multiple times
        this.timeConnectionLost = now;
        debugLog(`Baichuan host ${this.host}: disconnected while event subscription was not active`);
        return;
      }
      // Handle reconnection logic here if needed
      this.timeConnectionLost = now;
    }
  }

  private async getNonce(): Promise<string> {
    // Get the nonce needed for the modern login
    debugLog(`Baichuan host ${this.host}: requesting nonce...`);
    const mess = await this.send(1, null, "", "", EncType.BC, "1465");
    debugLog(`Baichuan host ${this.host}: nonce response length: ${mess.length}, content: '${mess}'`);
    
    if (!mess || mess.length === 0) {
      throw new UnexpectedDataError(`Baichuan host ${this.host}: received empty response when requesting nonce`);
    }
    
    const parsed = this.xmlParser.parse(mess);
    // Check both body.Encryption.nonce (modern devices) and body.nonce (if exists)
    this.nonce = parsed?.body?.Encryption?.nonce?._text || 
                 parsed?.body?.Encryption?.nonce || 
                 parsed?.body?.nonce?._text || 
                 parsed?.body?.nonce || 
                 null;

    if (!this.nonce) {
      throw new UnexpectedDataError(`Baichuan host ${this.host}: could not find nonce in response:\n${mess}`);
    }

    const aesKeyStr = md5StrModern(`${this.nonce}-${this.password}`).slice(0, 16);
    this.aesKey = Buffer.from(aesKeyStr, "utf8");
    debugLog(`Baichuan host ${this.host}: got nonce successfully, using modern login with AES encryption`);

    return this.nonce;
  }

  /**
   * Login using the Baichuan protocol
   */
  async login(): Promise<void> {
    // Use login mutex to prevent concurrent logins
    await this.loginMutex;
    let releaseMutex: () => void;
    this.loginMutex = new Promise((resolve) => {
      releaseMutex = resolve;
    });

    try {
      if (this.loggedIn) {
        debugLog(`Baichuan host ${this.host}: already logged in`);
        return;
      }

      debugLog(`Baichuan host ${this.host}: starting login...`);
      
      // Try modern login with nonce first
      try {
        const nonce = await this.getNonce();
        debugLog(`Baichuan host ${this.host}: got nonce, proceeding with modern login...`);

        // modern login
        this.userHash = md5StrModern(`${this.username}${nonce}`);
        this.passwordHash = md5StrModern(`${this.password}${nonce}`);
        const xml = xmls.buildLoginXml({ userName: this.userHash, password: this.passwordHash });

        const mess = await this.send(1, null, xml, "", EncType.BC);
        this.loggedIn = true;
        debugLog(`Baichuan host ${this.host}: logged in successfully with modern login`);

        // parse response
        const parsed = this.xmlParser.parse(mess);
        const devInfo = parsed?.body?.DeviceInfo;
        if (devInfo) {
          this.parseDeviceInfo(devInfo);
        }
      } catch (err) {
        // If nonce request fails, try legacy login with plaintext credentials
        if (err instanceof UnexpectedDataError && err.message.includes('nonce')) {
          debugLog(`Baichuan host ${this.host}: modern login failed, trying legacy login with plaintext credentials...`);
          
          // Legacy login with plaintext credentials
          debugLog(`Baichuan host ${this.host}: using credentials - username: ${this.username}, password: ${this.password}`);
          const xml = xmls.buildLoginXml({ userName: this.username, password: this.password });
          debugLog(`Baichuan host ${this.host}: generated login XML (length ${xml.length}): ${xml.substring(0, 200)}...`);
          debugLog(`Baichuan host ${this.host}: sending legacy login XML...`);
          
          try {
            const mess = await this.send(1, null, xml, "", EncType.BC);
            this.loggedIn = true;
            debugLog(`Baichuan host ${this.host}: logged in successfully with legacy login`);

            // parse response
            const parsed = this.xmlParser.parse(mess);
            const devInfo = parsed?.body?.DeviceInfo;
            if (devInfo) {
              this.parseDeviceInfo(devInfo);
            }
          } catch (legacyErr: any) {
            debugLog(`Baichuan host ${this.host}: legacy login error: ${legacyErr}`);
            if (legacyErr instanceof ApiError && legacyErr.rspCode === 401) {
              throw new CredentialsInvalidError(`Baichuan host ${this.host}: Invalid credentials during login`);
            }
            throw legacyErr;
          }
        } else if (err instanceof ApiError && err.rspCode === 401) {
          throw new CredentialsInvalidError(`Baichuan host ${this.host}: Invalid credentials during login`);
        } else {
          throw err;
        }
      }
    } finally {
      releaseMutex!();
    }
  }

  private parseDeviceInfo(devInfo: any): void {
    // is_nvr / is_hub
    const devType = devInfo.type?._text || devInfo.type;
    const devTypeInfo = devInfo.typeInfo?._text || devInfo.typeInfo;
    if (devType && devTypeInfo) {
      this.devType = devType;
      if (!this.httpApi["_isNvr"]) {
        this.httpApi["_isNvr"] =
          devType === "nvr" || devType === "wifi_nvr" || devType === "homehub" ||
          devTypeInfo === "NVR" || devTypeInfo === "WIFI_NVR" || devTypeInfo === "HOMEHUB";
      }
      if (!this.httpApi["_isHub"]) {
        this.httpApi["_isHub"] = devType === "homehub" || devTypeInfo === "HOMEHUB";
      }
    }

    // privacy mode
    if (devInfo.sleep?._text !== undefined || devInfo.sleep !== undefined) {
      const sleep = devInfo.sleep?._text === "1" || devInfo.sleep === 1 || devInfo.sleep === true;
      this.privacyMode.set(0, sleep);
    }

    // channels
    const channelNum = Number(devInfo.channelNum?._text || devInfo.channelNum || 0);
    if (channelNum > 0 && this.httpApi["_numChannels"] === 0 && !this.httpApi["_isNvr"]) {
      this.httpApi["_channels"] = [];
      this.httpApi["_numChannels"] = channelNum;
      for (let ch = 0; ch < channelNum; ch++) {
        this.httpApi["_channels"].push(ch);
      }
    }
  }

  /**
   * Close the TCP session and cleanup
   */
  async logout(): Promise<void> {
    if (this.subscribed) {
      // first call unsubscribe_events
      debugLog(`Baichuan host ${this.host}: logout called while still subscribed, keeping connection`);
      return;
    }

    if (this.loggedIn && this.transport && this.protocol) {
      try {
        const xml = xmls.buildLogoutXml({ userName: this.username, password: this.password });
        await this.send(2, null, xml);
      } catch (err) {
        if (err instanceof ReolinkError) {
          debugLog(`Baichuan host ${this.host}: failed to logout: ${err.message}`);
        }
      }

      try {
        this.protocol.close();
        await this.protocol.getCloseFuture();
      } catch (err) {
        debugLog(`Baichuan host ${this.host}: connection already reset when trying to close: ${err}`);
      }
    }

    this.loggedIn = false;
    this.eventsActive = false;
    this.transport = null;
    this.protocol = null;
    this.nonce = null;
    this.aesKey = null;
    this.userHash = null;
    this.passwordHash = null;
  }

  /**
   * Register a callback which is called when a push event is received
   */
  registerCallback(callbackId: string, callback: CallbackFunction, cmdId: number | null = null, channel: number | null = null): void {
    if (!this.extCallback.has(cmdId)) {
      this.extCallback.set(cmdId, new Map());
    }
    const cmdCallbacks = this.extCallback.get(cmdId)!;
    if (!cmdCallbacks.has(channel)) {
      cmdCallbacks.set(channel, new Map());
    }
    const channelCallbacks = cmdCallbacks.get(channel)!;
    if (channelCallbacks.has(callbackId)) {
      debugLog(`Baichuan host ${this.host}: callback id '${callbackId}', cmd_id ${cmdId}, ch ${channel} already registered, overwriting`);
    }
    channelCallbacks.set(callbackId, callback);
  }

  /**
   * Unregister a callback
   */
  unregisterCallback(callbackId: string): void {
    for (const [cmdId, cmdCallbacks] of this.extCallback.entries()) {
      for (const [channel, channelCallbacks] of cmdCallbacks.entries()) {
        channelCallbacks.delete(callbackId);
        if (channelCallbacks.size === 0) {
          cmdCallbacks.delete(channel);
        }
      }
      if (cmdCallbacks.size === 0) {
        this.extCallback.delete(cmdId);
      }
    }
  }

  /**
   * Subscribe to baichuan push events
   */
  async subscribeEvents(): Promise<void> {
    if (this.subscribed) {
      debugLog(`Baichuan host ${this.host}: already subscribed to events`);
      return;
    }

    debugLog(`Baichuan host ${this.host}: subscribing to events...`);
    
    // Check if we need to reconnect
    if (!this.transport || this.transport.destroyed) {
      debugLog(`Baichuan host ${this.host}: transport is destroyed, reconnecting...`);
      this.loggedIn = false; // Force re-login
    }
    
    await this.login();
    this.subscribed = true;
    this.eventsActive = true; // Mark as active immediately
    this.timeKeepaliveLoop = Date.now() / 1000;
    
    // Start keepalive loop BEFORE sending subscribe command
    // This ensures the loop is running even if cmd_id 31 fails
    this.keepaliveTask = setInterval(() => {
      this.keepaliveLoop().catch((err) => {
        debugLog(`Baichuan host ${this.host}: keepalive loop error: ${err}`);
      });
    }, this.keepaliveInterval * 1000);
    
    // Some devices don't respond to cmd_id 31, just send it and don't wait for response
    debugLog(`Baichuan host ${this.host}: sending subscribe command (cmd_id 31) without waiting...`);
    
    // Send cmd_id 31 but don't wait for it - just fire and forget
    this.send(31, null, "", "", undefined, undefined, 251).catch((err) => {
      debugLog(`Baichuan host ${this.host}: cmd_id 31 failed (this is OK): ${err}`);
    });
  }

  /**
   * Unsubscribe from baichuan push events
   */
  async unsubscribeEvents(): Promise<void> {
    this.subscribed = false;
    this.eventsActive = false;
    if (this.keepaliveTask) {
      clearInterval(this.keepaliveTask);
      this.keepaliveTask = null;
    }
    await this.logout();
  }

  private async keepaliveLoop(): Promise<void> {
    if (!this.subscribed || !this.eventsActive) {
      return;
    }

    try {
      // Use cmd_id 93 (LinkType) for keepalive, not cmd_id 31 (subscribe)
      await this.send(93);
      this.timeKeepaliveLoop = Date.now() / 1000;
    } catch (err) {
      debugLog(`Baichuan host ${this.host}: keepalive failed: ${err}`);
    }
  }

  private parseXml(cmdId: number, xml: string): void {
    // Parse received XML
    try {
      const parsed = this.xmlParser.parse(xml);
      
      // Handle cmd_id 33: Motion/AI/Visitor events
      if (cmdId === 33) {
        const body = parsed.body;
        if (!body) return;

        // Iterate through event lists (like AlarmEventList)
        for (const key in body) {
          const eventList = body[key];
          if (!eventList) continue;

          // Handle both single event and array of events
          const events = Array.isArray(eventList) ? eventList : (Array.isArray(eventList.AlarmEvent) ? eventList.AlarmEvent : [eventList]);
          
          for (const event of events) {
            if (!event) continue;

            const alarmEvent = event.AlarmEvent ?? event;
            if (!alarmEvent) continue;

            // Get channel from the event
            const channelId = alarmEvent.channelId ?? alarmEvent.channel;
            if (channelId === undefined) continue;
            
            const channel = Number(channelId);
            if (!this.httpApi._channels.includes(channel)) continue;

            // Handle AlarmEvent
            if (alarmEvent.status !== undefined || alarmEvent.AItype !== undefined) {
              // Mark events as active
              if (!this.eventsActive && this.subscribed) {
                this.eventsActive = true;
                debugLog(`Baichuan host ${this.host}: events are now active`);
              }

              // Parse motion detection state
              if (alarmEvent.status !== undefined) {
                const states = String(alarmEvent.status);
                const motionState = states.includes('MD');
                const visitorState = states.includes('visitor');

                // Update motion state
                const oldMotion = this.httpApi._motionDetectionStates.get(channel) || false;
                if (motionState !== oldMotion) {
                  debugLog(`Reolink ${this.httpApi.nvrName} TCP event channel ${channel}, motion: ${motionState}`);
                }
                this.httpApi._motionDetectionStates.set(channel, motionState);

                // Update visitor state
                const oldVisitor = this.httpApi._visitorStates.get(channel) || false;
                if (visitorState !== oldVisitor) {
                  debugLog(`Reolink ${this.httpApi.nvrName} TCP event channel ${channel}, visitor: ${visitorState}`);
                }
                this.httpApi._visitorStates.set(channel, visitorState);
              }

              // Parse AI detection states
              if (alarmEvent.AItype !== undefined) {
                const aiTypes = String(alarmEvent.AItype);
                const aiStates = this.httpApi._aiDetectionStates.get(channel);
                
                if (aiStates) {
                  for (const [aiTypeKey, oldState] of aiStates.entries()) {
                    const aiState = aiTypes.includes(aiTypeKey);
                    if (aiState !== oldState) {
                      debugLog(`Reolink ${this.httpApi.nvrName} TCP event channel ${channel}, ${aiTypeKey}: ${aiState}`);
                    }
                    aiStates.set(aiTypeKey, aiState);
                  }
                }

                // Handle "other" AI type for PIR/battery cams
                const motionState = this.httpApi._motionDetectionStates.get(channel) || false;
                if (!motionState && aiTypes.includes('other')) {
                  this.httpApi._motionDetectionStates.set(channel, true);
                }
              }

              // Execute callbacks
              this.executeCallbacks(cmdId, channel);
              this.executeCallbacks(cmdId, null); // Execute channel-agnostic callbacks
            }
          }
        }
      }
    } catch (err) {
      debugLog(`Baichuan host ${this.host}: error parsing XML for cmd_id ${cmdId}: ${err}`);
    }
  }

  private executeCallbacks(cmdId: number | null, channel: number | null): void {
    const cmdCallbacks = this.extCallback.get(cmdId);
    if (!cmdCallbacks) return;

    const channelCallbacks = cmdCallbacks.get(channel);
    if (!channelCallbacks) return;

    for (const callback of channelCallbacks.values()) {
      try {
        callback();
      } catch (err) {
        debugLog(`Baichuan host ${this.host}: error executing callback: ${err}`);
      }
    }
  }

  // Property getters
  get eventsActiveValue(): boolean {
    return this.eventsActive && Date.now() / 1000 - this.timeConnectionLost > 120;
  }

  get sessionActive(): boolean {
    return this.loggedIn || (this.protocol !== null && Date.now() / 1000 - this.protocol.timeRecvValue < 60);
  }

  get subscribedValue(): boolean {
    return this.subscribed;
  }

  /**
   * Play an audio alarm (siren) on the camera
   * @param channel - Channel number (null for hub-wide)
   * @param options - Alarm play parameters
   */
  async audioAlarmPlay(
    channel: number | null,
    options: { alarmMode: "times" | "manual"; times?: number; manualSwitch?: boolean }
  ): Promise<void> {
    const isHub = this.httpApi["_isHub"] || false;
    const alarmMode = options.alarmMode;
    const times = Math.max(1, options.times ?? 1);
    const manualSwitch = options.manualSwitch ?? true;

    let xml: string;

    if (channel !== null) {
      if (alarmMode === "times") {
        xml = xmls.buildSirenTimesXml({ channel: channel.toString(), times: times.toString() });
      } else {
        xml = xmls.buildSirenManualXml({ channel: channel.toString(), enable: manualSwitch ? "1" : "0" });
      }
    } else if (isHub) {
      if (alarmMode === "times") {
        xml = xmls.buildSirenHubTimesXml({ times: times.toString() });
      } else {
        xml = xmls.buildSirenHubManualXml({ enable: manualSwitch ? "1" : "0" });
      }
    } else {
      throw new InvalidParameterError(`audioAlarmPlay: channel must be specified for non-hub devices`);
    }

    try {
      await this.send(263, channel, xml);
      debugLog(
        `Baichuan host ${this.host}: Audio alarm ${alarmMode === "times" ? `times=${times}` : manualSwitch ? "manual on" : "manual off"} on channel ${channel}`
      );
    } catch (err) {
      if (alarmMode === "manual" && manualSwitch) {
        debugLog(
          `Baichuan host ${this.host}: AudioAlarmPlay manual mode failed, retrying with times fallback (channel ${channel})`
        );
        const fallbackXml = channel !== null
          ? xmls.buildSirenTimesXml({ channel: channel.toString(), times: "2" })
          : xmls.buildSirenHubTimesXml({ times: "2" });
        await this.send(263, channel, fallbackXml);
        return;
      }
      throw err;
    }
  }

  /**
   * Fetch the host settings/capabilities
   */
  async getHostData(): Promise<void> {
    // Skip abilities request for devices using legacy login (they don't support it)
    if (!this.loggedIn) {
      await this.login();
    }
    
    // Only try to get abilities if we have AES key (modern login)
    if (this.aesKey) {
      try {
        debugLog(`Baichuan host ${this.host}: getting abilities (cmd_id 199)...`);
        // Don't retry cmd_id 199 - some devices don't support it and will close the connection
        const mess = await this.send(199, null, "", "", EncType.AES, "1464", null, 0);
        const parsed = this.xmlParser.parse(mess);
        // Parse abilities - simplified version
        // Full implementation would parse all capabilities
        debugLog(`Baichuan host ${this.host}: got abilities successfully`);
      } catch (err) {
        debugLog(`Baichuan host ${this.host}: Could not obtain abilities (cmd_id 199): ${err}`);
      }
    } else {
      debugLog(`Baichuan host ${this.host}: Skipping abilities request (legacy login device)`);
    }

    // Host capabilities
    this.capabilities.set(null, this.capabilities.get(null) || new Set());
    // Add capabilities based on API versions
    // Simplified - full implementation needed
  }  /**
   * Update the state information of polling data
   */
  async getStates(cmdList: Record<string, Record<string, number>> | Record<string, Array<number>> | null = null, wake: Map<number, boolean> | null = null): Promise<void> {
    // Simplified implementation
    // Full implementation would handle all state commands
    if (!wake) {
      wake = new Map();
      for (const ch of this.httpApi["_channels"]) {
        wake.set(ch, true);
      }
    }

    // Get various states
    // This is a placeholder - full implementation needed
  }
}


