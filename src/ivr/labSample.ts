import type { IvrSaveInput } from "../domain/types.js";

/** Name of the lab DID-7777 sample IVR (your previous project JSON). */
export const LAB_SAMPLE_IVR_NAME = "LAB-Sample-IVR-7777-Testing-Only";

type LegacyOption = { action: string; param?: string; success?: string; fail?: string };
type LegacyMenu = {
  name: string;
  description?: string;
    fileMenu?: string;
    menuFile?: string;
  fileInvalid?: string;
  inputTimeout?: number;
  retries?: number;
  options: Record<string, LegacyOption>;
};

function fromLegacyMap(name: string, raw: Record<string, LegacyMenu>): IvrSaveInput {
  const menus = Object.entries(raw).map(([fullKey, m], i) => ({
    key: fullKey.replace(/^IVR-Menu-/i, "") || fullKey,
    name: m.name,
    description: m.description ?? "",
    menuFile: m.menuFile ?? m.fileMenu ?? "",
    fileInvalid: m.fileInvalid ?? "",
    inputTimeout: m.inputTimeout ?? 0,
    retries: m.retries ?? 0,
    isEntry: i === 0,
    options: Object.entries(m.options).map(([when, o]) => ({
      when,
      action: o.action,
      param: o.param ?? "",
      success: o.success ?? "",
      fail: o.fail ?? "",
    })),
  }));
  return { name, enabled: true, entryKey: menus[0]!.key, menus };
}

/**
 * Sample from the previous project. Menu 1.1 goes to 1.2 (language/queue)
 * instead of jumping to answer, so those PULSE steps actually run.
 */
export const LAB_SAMPLE_IVR: IvrSaveInput = fromLegacyMap(LAB_SAMPLE_IVR_NAME, {
  "IVR-Menu-1": {
    name: "Create The Interaction",
    description: "Interaction Creation API Call",
    menuFile: "",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "proc_createinteraction",
        param: "",
        success: "GOTO_MENU 1.1",
        fail: "hangup",
      },
    },
  },
  "IVR-Menu-1.1": {
    name: "Create The Session",
    description: "Session Creation API Call",
    menuFile: "",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "proc_createsession",
        param: "",
        success: "GOTO_MENU 1.2",
        fail: "hangup",
      },
    },
  },
  "IVR-Menu-1.2": {
    name: "Set Internal Lanauage",
    description: "Set Internal Lanauage",
    menuFile: "",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "proc_setlanguagequeueid 1",
        param: "",
        success: "GOTO_MENU 1.3",
        fail: "GOTO_MENU 1.3",
      },
    },
  },
  "IVR-Menu-1.3": {
    name: "Set Internal menuqueueid",
    description: "Set Internal Mene Queue ID",
    menuFile: "",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "proc_setmenuqueueid 1",
        param: "",
        success: "GOTO_MENU 1.4",
        fail: "GOTO_MENU 1.4",
      },
    },
  },
  "IVR-Menu-1.4": {
    name: "Set Internal virtualqueueid",
    description: "Set Internal virial Queue ID",
    menuFile: "",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "proc_setvirtualqueueid 1",
        param: "",
        success: "GOTO_MENU 2",
        fail: "GOTO_MENU 2",
      },
    },
  },
  "IVR-Menu-2": {
    name: "Call Answering Menu",
    description: "Call Answering Menu",
    menuFile: "none",
    fileInvalid: "none",
    inputTimeout: 5,
    retries: 3,
    options: {
      none: {
        action: "Answer",
        param: "",
        success: "GOTO_MENU 3",
        fail: "Hangup",
      },
    },
  },
  "IVR-Menu-3": {
    name: "play the greeting file",
    description: "its nothing just play the greeting file",
    menuFile: "BOK_GREETINGS.wav A",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "GOTO_MENU 4",
        param: "",
        success: "GOTO_MENU 4",
        fail: "GOTO_MENU 4",
      },
    },
  },
  "IVR-Menu-4": {
    name: "LanguageSelect",
    description: "Caller is required to make language selection",
    menuFile: "BOK_Menu_LanguageSelection.wav",
    fileInvalid: "BOK_Invalid.wav",
    inputTimeout: 5,
    retries: 3,
    options: {
      "1": {
        action: "setlanguage 0",
        param: "",
        success: "GOTO_MENU 4.1",
        fail: "GOTO_MENU 4.1",
      },
      "2": {
        action: "setlanguage 1",
        param: "",
        success: "GOTO_MENU 4.1",
        fail: "GOTO_MENU 4.1",
      },
      "3": {
        action: "setlanguage 2",
        param: "",
        success: "GOTO_MENU 4.1",
        fail: "GOTO_MENU 4.1",
      },
      none: { action: "repeat", param: "", success: "", fail: "" },
      MaxTries: { action: "hangup", param: "", success: "", fail: "" },
    },
  },
  "IVR-Menu-4.1": {
    name: "Send Selection Update to PULSE",
    description: "Send Selection Update to PULSE",
    menuFile: "",
    fileInvalid: "",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "proc_reportproduct",
        param: "",
        success: "GOTO_MENU 5",
        fail: "GOTO_MENU 5",
      },
    },
  },
  "IVR-Menu-5": {
    name: "Top Menu",
    description: "Top Menu for the Caller",
    menuFile: "BOK_CallbackOption",
    fileInvalid: "BOK_Invalid.wav",
    inputTimeout: 5,
    retries: 3,
    options: {
      "1": {
        action: "proc_bok_authcaller testing,123,123213",
        param: "",
        success: "GOTO_MENU IVR-Menu-3",
        fail: "GOTO_MENU IVR-Menu-3",
      },
      "2": { action: "GOTO_MENU 7", param: "", success: "GOTO_MENU 7", fail: "GOTO_MENU 7" },
      "3": { action: "GOTO_MENU 8", param: "", success: "GOTO_MENU 8", fail: "GOTO_MENU 8" },
      "4": { action: "Playstring XYZ123", param: "", success: "GOTO_MENU 4", fail: "GOTO_MENU 4" },
      "5": { action: "PlayNumbers 6763401.98", param: "", success: "GOTO_MENU 4", fail: "GOTO_MENU 4" },
      "6": { action: "QueueManager 2000", param: "", success: "hangup", fail: "hangup" },
      "7": { action: "Proc_BOK_AuthCaller", param: "BOK", success: "GOTO_MENU 4", fail: "GOTO_MENU 4" },
      "8": {
        action: "GOTO_MENU IVR-Menu-Extension-Test",
        param: "",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "*": { action: "GOTO_MENU 4", param: "", success: "GOTO_MENU 8", fail: "GOTO_MENU 8" },
      "#": { action: "hangup", param: "", success: "", fail: "" },
      none: { action: "repeat", param: "", success: "", fail: "" },
      MaxTries: { action: "hangup", param: "", success: "", fail: "" },
    },
  },
  "IVR-Menu-6": {
    name: "Customer Service Queue",
    description: "Transfer to customer service queue",
    menuFile: "none",
    fileInvalid: "none",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "QueueManager 2000",
        param: "",
        success: "hangup",
        fail: "GOTO_MENU IVR-Menu-99",
      },
    },
  },
  "IVR-Menu-7": {
    name: "Technical Support Queue",
    description: "Transfer to technical support queue",
    menuFile: "none",
    fileInvalid: "none",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "QueueManager 2000",
        param: "",
        success: "hangup",
        fail: "GOTO_MENU IVR-Menu-99",
      },
    },
  },
  "IVR-Menu-8": {
    name: "Sales Department Queue",
    description: "Transfer to sales department queue",
    menuFile: "none",
    fileInvalid: "none",
    inputTimeout: 0,
    retries: 0,
    options: {
      none: {
        action: "QueueManager 2000",
        param: "",
        success: "hangup",
        fail: "GOTO_MENU IVR-Menu-99",
      },
    },
  },
  "IVR-Menu-99": {
    name: "Default Fallback Menu",
    description: "Default menu for unhandled calls or errors",
    menuFile: "BOK_Invalid.wav",
    fileInvalid: "BOK_Invalid.wav",
    inputTimeout: 5,
    retries: 2,
    options: {
      "0": { action: "QueueManager 2000", param: "", success: "hangup", fail: "hangup" },
      "*": {
        action: "GOTO_MENU IVR-Menu-4",
        param: "",
        success: "GOTO_MENU IVR-Menu-4",
        fail: "hangup",
      },
      none: { action: "repeat", param: "", success: "", fail: "" },
      MaxTries: { action: "hangup", param: "", success: "", fail: "" },
    },
  },
  "IVR-Menu-Extension-Test": {
    name: "Extension Test Menu",
    description: "Test menu for extension functionality",
    menuFile: "BOK_MainMenu.wav",
    fileInvalid: "BOK_Invalid.wav",
    inputTimeout: 10,
    retries: 3,
    options: {
      "1": {
        action: "sample",
        param: "greet",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "2": {
        action: "sample",
        param: "collect,5",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "3": {
        action: "sample",
        param: "echo",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "4": {
        action: "banking",
        param: "menu",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "5": {
        action: "banking",
        param: "balance",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "6": {
        action: "crm",
        param: "status",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "7": {
        action: "crm",
        param: "interaction",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "8": {
        action: "crm",
        param: "customer",
        success: "GOTO_MENU IVR-Menu-Extension-Test",
        fail: "GOTO_MENU IVR-Menu-Extension-Test",
      },
      "0": {
        action: "GOTO_MENU IVR-Menu-5",
        param: "",
        success: "GOTO_MENU IVR-Menu-5",
        fail: "GOTO_MENU IVR-Menu-5",
      },
      "*": {
        action: "GOTO_MENU IVR-Menu-5",
        param: "",
        success: "GOTO_MENU IVR-Menu-5",
        fail: "GOTO_MENU IVR-Menu-5",
      },
      "#": { action: "hangup", param: "", success: "", fail: "" },
      none: { action: "repeat", param: "", success: "", fail: "" },
      MaxTries: { action: "hangup", param: "", success: "", fail: "" },
    },
  },
});
