// Minimal mock of the VS Code extension API, just wide enough for
// extension.js. State is exposed through _state so tests can seed settings,
// fire events and inspect what the extension did.

"use strict";

const state = {
  settings: {}, // raw values as a settings.json would carry them
  settingsWorkspace: {}, // keys pinned at workspace level
  updates: [], // {key, value, target} written through config.update
  documents: new Map(), // uri -> text
  textDocumentListeners: [],
  configurationListeners: [],
  colorThemeListeners: [],
  errorMessages: [], // {message, buttons}
  errorChoices: {}, // message fragment -> button the user "presses"
  infoMessages: [], // {message, buttons}
  outputChannels: [], // {name, lines, shown}
  progressTitles: [],
  savedUris: [],
  openedExternal: [],
  dirtyDocuments: new Set(), // uris whose mock document reports isDirty
  workspaceFolder: null, // fsPath served by getWorkspaceFolder
  registeredProviders: [],
  extensions: [], // {extensionPath, packageJSON}, for the theme lookup
  activeColorThemeKind: 1, // vscode.ColorThemeKind.Light
};

function reset() {
  state.settings = {};
  state.settingsWorkspace = {};
  state.updates = [];
  state.documents = new Map();
  state.textDocumentListeners = [];
  state.configurationListeners = [];
  state.colorThemeListeners = [];
  state.errorMessages = [];
  state.errorChoices = {};
  state.infoMessages = [];
  state.outputChannels = [];
  state.progressTitles = [];
  state.savedUris = [];
  state.openedExternal = [];
  state.dirtyDocuments = new Set();
  state.workspaceFolder = null;
  state.registeredProviders = [];
  state.extensions = [];
  state.activeColorThemeKind = 1;
}

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };

const workspace = {
  getConfiguration(section) {
    return {
      get(key) {
        return state.settings[section + "." + key];
      },
      inspect(key) {
        const full = section + "." + key;
        return {
          key: full,
          globalValue: undefined,
          workspaceValue: state.settingsWorkspace[full],
        };
      },
      async update(key, value, target) {
        state.updates.push({ key: section + "." + key, value, target });
        state.settings[section + "." + key] = value;
      },
    };
  },
  onDidChangeTextDocument(listener) {
    state.textDocumentListeners.push(listener);
    return {
      dispose() {
        const i = state.textDocumentListeners.indexOf(listener);
        if (i !== -1) state.textDocumentListeners.splice(i, 1);
      },
    };
  },
  onDidChangeConfiguration(listener) {
    state.configurationListeners.push(listener);
    return {
      dispose() {
        const i = state.configurationListeners.indexOf(listener);
        if (i !== -1) state.configurationListeners.splice(i, 1);
      },
    };
  },
  getWorkspaceFolder() {
    return state.workspaceFolder
      ? { uri: { fsPath: state.workspaceFolder } }
      : undefined;
  },
  async save(uri) {
    state.savedUris.push(uri.toString());
    state.dirtyDocuments.delete(uri.toString());
    return uri;
  },
  async applyEdit(edit) {
    // Apply every replace as a full-document replace (which is how
    // extension.js uses it) and fire the change event the way VS Code does.
    edit._replacements.forEach(({ uri, newText }) => {
      state.documents.set(uri.toString(), newText);
      const doc = makeDocument(uri.toString());
      state.textDocumentListeners.forEach((l) => l({ document: doc }));
    });
    return true;
  },
};

function makeDocument(uriString) {
  return {
    uri: {
      // The scheme decides whether the document is a file on disk, which is
      // what says the webview may be given the root of its filesystem.
      scheme: (/^([a-z][a-z0-9+.-]*):/i.exec(uriString) || [])[1] || "file",
      path: uriString.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, "/").replace(/^\/+/, "/"),
      toString: () => uriString,
      fsPath: uriString.replace(/^file:\/\//, ""),
    },
    get isDirty() {
      return state.dirtyDocuments.has(uriString);
    },
    getText: () => state.documents.get(uriString) || "",
    get lineCount() {
      return (state.documents.get(uriString) || "").split("\n").length;
    },
  };
}

class WorkspaceEdit {
  constructor() {
    this._replacements = [];
  }
  replace(uri, range, newText) {
    this._replacements.push({ uri, range, newText });
  }
}

class Range {
  constructor(a, b, c, d) {
    this.start = { line: a, character: b };
    this.end = { line: c, character: d };
  }
}

const Uri = {
  // `..` is resolved, as the real joinPath does: the extension asks for the
  // folder of a document that way.
  joinPath(base, ...parts) {
    const joined = [base.path || base.toString()].concat(parts).join("/");
    const out = [];
    joined.split("/").forEach((seg) => {
      if (seg !== "..") out.push(seg);
      else if (out.length > 1) out.pop(); // the root is never left behind
    });
    const path = out.join("/") || "/";
    return { path, scheme: base.scheme || "file", toString: () => path };
  },
  file(p) {
    return { path: p, toString: () => "file://" + p };
  },
};

const window = {
  registerCustomEditorProvider(viewType, provider, options) {
    state.registeredProviders.push({ viewType, provider, options });
    return { dispose() {} };
  },
  // Buttons and a thenable, like showInformationMessage: the export offers a
  // "Show log" here. A test seeds _state.errorChoices with a fragment of the
  // message to say which button the user presses.
  showErrorMessage(message, ...buttons) {
    state.errorMessages.push({ message, buttons });
    const hit = Object.keys(state.errorChoices).find((k) => message.includes(k));
    return Promise.resolve(hit ? state.errorChoices[hit] : undefined);
  },
  // The MDM channel the export writes its log to. One object per name, so a
  // test reads back everything the extension appended over a whole run.
  createOutputChannel(name) {
    // The record is looked up on every call and not held: the extension keeps
    // the channel it made at activation, and _reset() between tests empties
    // this list, so a held object has to find its way back to the new one.
    const record = function () {
      let channel = state.outputChannels.find((c) => c.name === name);
      if (!channel) {
        channel = { name, lines: [], shown: 0 };
        state.outputChannels.push(channel);
      }
      return channel;
    };
    record();
    return {
      name,
      appendLine(line) {
        record().lines.push(String(line));
      },
      append(text) {
        record().lines.push(String(text));
      },
      show() {
        record().shown++;
      },
      clear() {
        record().lines.length = 0;
      },
      dispose() {},
    };
  },
  showInformationMessage(message, ...buttons) {
    state.infoMessages.push({ message, buttons });
    return Promise.resolve(undefined);
  },
  withProgress(options, task) {
    state.progressTitles.push(options && options.title);
    return task();
  },
  // The theme VS Code itself is showing, which is what mdm.theme = "auto"
  // follows. Seeded through _state.activeColorThemeKind.
  get activeColorTheme() {
    return { kind: state.activeColorThemeKind };
  },
  onDidChangeActiveColorTheme(listener) {
    state.colorThemeListeners.push(listener);
    return {
      dispose() {
        const i = state.colorThemeListeners.indexOf(listener);
        if (i !== -1) state.colorThemeListeners.splice(i, 1);
      },
    };
  },
};

// The theme lookup walks this list; the tests seed it through _state.
const extensions = {
  get all() {
    return state.extensions;
  },
};

const ProgressLocation = { Notification: 15 };

const env = {
  openExternal(uri) {
    state.openedExternal.push(uri.toString());
    return Promise.resolve(true);
  },
};

module.exports = {
  workspace,
  window,
  extensions,
  env,
  ProgressLocation,
  WorkspaceEdit,
  Range,
  Uri,
  ConfigurationTarget,
  ColorThemeKind,
  _state: state,
  _reset: reset,
  _makeDocument: makeDocument,
};
