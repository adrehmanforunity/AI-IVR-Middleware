import type { Ivr, IvrMenuDraft, IvrSaveInput } from "../domain/types.js";

export const HUGO_IVR_NAME = "Hugo Bank IVR";
/** Inbound DID for the seeded Hugo Bank route. */
export const HUGO_INBOUND_DID = "7777";

function menu(partial: IvrMenuDraft): IvrMenuDraft {
  return partial;
}

/**
 * Hugo Bank on the generic IVR engine (no bank `if` in code).
 * First blocks match the product sample: Create Interaction → Create Session → Answer.
 */
export const HUGO_BANK_IVR: IvrSaveInput = {
  name: HUGO_IVR_NAME,
  enabled: true,
  entryKey: "create-interaction",
  menus: [
    menu({
      key: "create-interaction",
      name: "Create The Interaction",
      description: "Pulse Create Interaction. Fail → hangup unanswered.",
      menuFile: "none",
      inputTimeout: 0,
      maxNoInput: 0,
      isEntry: true,
      options: [
        {
          when: "none",
          action: "proc_createinteraction",
          success: "GOTO_MENU create-session",
          fail: "hangup",
        },
      ],
    }),
    menu({
      key: "create-session",
      name: "Create The Session",
      description: "Pulse Create Session. Fail → hangup unanswered.",
      menuFile: "none",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [
        {
          when: "none",
          action: "proc_createsession",
          success: "GOTO_MENU answer",
          fail: "hangup",
        },
      ],
    }),
    menu({
      key: "answer",
      name: "Answer",
      description: "Answer after Pulse Create Interaction + Create Session",
      menuFile: "none",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [
        { when: "none", action: "answer", success: "GOTO_MENU greeting", fail: "hangup" },
      ],
    }),
    menu({
      key: "greeting",
      name: "Greeting",
      description: "Hugo welcome prompts",
      menuFile: "hugo-greeting, hugo-greeting-2",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [{ when: "none", action: "goto", success: "GOTO_MENU language", fail: "GOTO_MENU language" }],
    }),
    menu({
      key: "language",
      name: "Language",
      description: "1 Urdu, 2 English",
      menuFile: "hugo-language-selection",
      fileInvalid: "ivr_Incorrect_Menu_Option",
      fileNoInput: "ivr_NoInput",
      inputsAcceptable: "12",
      inputTimeout: 10,
      maxNoInput: 3,
      maxInvalid: 3,
      onMaxNoInput: "GOTO_MENU disclaimer",
      onMaxInvalid: "GOTO_MENU disclaimer",
      options: [
        {
          when: "1",
          action: "proc_setlanguage",
          param: "ur",
          success: "GOTO_MENU disclaimer",
          fail: "GOTO_MENU disclaimer",
        },
        {
          when: "2",
          action: "proc_setlanguage",
          param: "en",
          success: "GOTO_MENU disclaimer",
          fail: "GOTO_MENU disclaimer",
        },
        { when: "none", action: "repeat", success: "repeat", fail: "repeat" },
        { when: "MaxTries", action: "goto", success: "GOTO_MENU disclaimer", fail: "GOTO_MENU disclaimer" },
      ],
    }),
    menu({
      key: "disclaimer",
      name: "Disclaimer",
      menuFile: "hugo-no-personal-details_{language}",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [{ when: "none", action: "goto", success: "GOTO_MENU main", fail: "GOTO_MENU main" }],
    }),
    menu({
      key: "main",
      name: "Main menu",
      description: "1 Service blocking, 2 Fraud, 3 Complaints, 0 Agent",
      menuFile: "hugo-main-menu_{language}",
      fileInvalid: "ivr_Invalid_en",
      fileNoInput: "ivr_NoInput",
      inputsAcceptable: "1230",
      inputTimeout: 15,
      maxNoInput: 3,
      maxInvalid: 3,
      onMaxNoInput: "GOTO_MENU agent-soon",
      onMaxInvalid: "GOTO_MENU agent-soon",
      options: [
        {
          when: "1",
          action: "proc_reportproduct",
          param: "TOP_MENU_SERVICE_BLOCKING",
          success: "GOTO_MENU svc-soon",
          fail: "GOTO_MENU svc-soon",
        },
        {
          when: "2",
          action: "proc_reportproduct",
          param: "TOP_MENU_FRAUD_REPORTING",
          success: "GOTO_MENU fraud-soon",
          fail: "GOTO_MENU fraud-soon",
        },
        {
          when: "3",
          action: "proc_reportproduct",
          param: "TOP_MENU_COMPLAINTS",
          success: "GOTO_MENU complaint-soon",
          fail: "GOTO_MENU complaint-soon",
        },
        {
          when: "0",
          action: "proc_reportproduct",
          param: "TOP_MENU_TALK_TO_AGENT",
          success: "GOTO_MENU agent-soon",
          fail: "GOTO_MENU agent-soon",
        },
        { when: "none", action: "repeat", success: "repeat", fail: "repeat" },
        { when: "MaxTries", action: "goto", success: "GOTO_MENU agent-soon", fail: "GOTO_MENU agent-soon" },
      ],
    }),
    menu({
      key: "svc-soon",
      name: "Service blocking (next)",
      description: "CNIC/TPIN collect comes next. Prompt is the enter-CNIC file so language substitution can be tested.",
      menuFile: "hugo-enter-cnic_{language}",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [{ when: "none", action: "goto", success: "GOTO_MENU main", fail: "GOTO_MENU main" }],
    }),
    menu({
      key: "fraud-soon",
      name: "Fraud reporting (next)",
      menuFile: "hugo-fraud-reporting-menu_{language}",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [{ when: "none", action: "goto", success: "GOTO_MENU main", fail: "GOTO_MENU main" }],
    }),
    menu({
      key: "complaint-soon",
      name: "Complaints (next)",
      menuFile: "hugo-complaint-transfer_{language}",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [{ when: "none", action: "goto", success: "GOTO_MENU agent-soon", fail: "GOTO_MENU agent-soon" }],
    }),
    menu({
      key: "agent-soon",
      name: "Talk to agent (next)",
      description: "Working-day / queue treatment comes next.",
      menuFile: "Tranfer_Agent",
      inputTimeout: 0,
      maxNoInput: 0,
      options: [{ when: "none", action: "hangup", success: "hangup", fail: "hangup" }],
    }),
  ],
};

export function hugoLanguageNeedsMigrate(ivr: Ivr): boolean {
  if (ivr.menus.some((m) => m.key === "lang-ur" || m.key === "lang-en")) return true;
  const lang = ivr.menus.find((m) => m.key === "language");
  if (!lang) return false;
  return lang.options.some((o) => {
    const a = o.action.toLowerCase();
    return a === "setlanguage" || o.success.includes("lang-ur") || o.success.includes("lang-en");
  });
}

export function applyHugoLanguageMigrate(ivr: Ivr): IvrSaveInput {
  const language = HUGO_BANK_IVR.menus.find((m) => m.key === "language")!;
  return {
    name: ivr.name,
    enabled: ivr.enabled,
    entryKey: ivr.entryKey,
    menus: ivr.menus
      .filter((m) => m.key !== "lang-ur" && m.key !== "lang-en")
      .map((m) =>
        m.key === "language"
          ? {
              ...m,
              isEntry: m.key === ivr.entryKey,
              description: language.description,
              options: language.options,
            }
          : { ...m, isEntry: m.key === ivr.entryKey },
      ),
  };
}
