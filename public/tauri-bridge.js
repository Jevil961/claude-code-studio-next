(function () {
  if (window.agentBridge) return;

  const invokeChannels = {
    bootstrapData: "app:bootstrapData",
    checkEnv: "env:check",
    chooseFolder: "dialog:chooseFolder",
    chooseFile: "dialog:chooseFile",
    openCcSwitch: "ccswitch:open",
    listProviders: "ccswitch:listProviders",
    switchProvider: "ccswitch:switchProvider",
    createProvider: "ccswitch:createProvider",
    getProviderPresets: "ccswitch:getProviderPresets",
    fetchModels: "ccswitch:fetchModels",
    updateProvider: "ccswitch:updateProvider",
    deleteProvider: "ccswitch:deleteProvider",
    testProvider: "ccswitch:testProvider",
    listSkills: "ccswitch:listSkills",
    syncSkills: "ccswitch:syncSkills",
    previewSkillsSync: "ccswitch:previewSkillsSync",
    importSkill: "ccswitch:importSkill",
    updateSkill: "ccswitch:updateSkill",
    deleteSkill: "ccswitch:deleteSkill",
    listMcp: "ccswitch:listMcp",
    syncMcp: "ccswitch:syncMcp",
    previewMcpSync: "ccswitch:previewMcpSync",
    setMcpEnabled: "ccswitch:setMcpEnabled",
    addMcp: "ccswitch:addMcp",
    importMcp: "ccswitch:importMcp",
    updateMcp: "ccswitch:updateMcp",
    deleteMcp: "ccswitch:deleteMcp",
    listProjects: "ccswitch:listProjects",
    refreshProjects: "ccswitch:refreshProjects",
    refreshProjectsBackground: "ccswitch:refreshProjectsBackground",
    validateSession: "ccswitch:validateSession",
    readSession: "ccswitch:readSession",
    listPlugins: "ccswitch:listPlugins",
    importPluginFolder: "plugins:importFolder",
    installPluginByName: "plugins:installByName",
    deletePlugin: "plugins:delete",
    listAutomations: "ccswitch:listAutomations",
    listUsage: "ccswitch:listUsage",
    diagnostics: "diagnostics:get",
    diagnosticReport: "diagnostics:report",
    checkClaude: "env:checkClaude",
    openPath: "path:open",
    readText: "path:readText",
    copyText: "clipboard:writeText",
    runClaude: "claude:run",
    answerQuestion: "claude:answerQuestion",
    stopClaude: "claude:stop",
    reconnectClaude: "claude:reconnect",
    listRunners: "claude:listRunners",
    stopRunner: "claude:stopRunner",
    rescanSkills: "skills:rescan",
    listSkillCategories: "skills:listCategories",
    syncIdentitySkills: "skills:syncIdentity",
    listIdentities: "identities:list",
    getActiveIdentity: "identities:getActive",
    setActiveIdentity: "identities:setActive",
    createIdentity: "identities:create",
    updateIdentity: "identities:update",
    deleteIdentity: "identities:delete",
    autoGenerateIdentities: "identities:autoGenerate",
    analyzeSkillsIdentities: "identities:analyzeSkills",
    setCategoryEnabled: "identities:setCategoryEnabled",
    setSkillInCategory: "identities:setSkillInCategory",
    enableAllInCategory: "identities:enableAllInCategory",
    disableAllInCategory: "identities:disableAllInCategory",
    listTeams: "teams:list",
    createTeam: "teams:create",
    updateTeam: "teams:update",
    deleteTeam: "teams:delete",
    createTeamMember: "teams:createMember",
    updateTeamMember: "teams:updateMember",
    deleteTeamMember: "teams:deleteMember",
    createTeamStep: "teams:createStep",
    updateTeamStep: "teams:updateStep",
    deleteTeamStep: "teams:deleteStep",
    updateTeamWorkflow: "teams:updateWorkflow",
    composeTeamStepPrompt: "teams:composeStepPrompt",
    detectClaude: "claude:detect",
    getClaudeSetup: "claude:getSetup",
    dismissSetup: "claude:dismissSetup",
    resetSetup: "claude:resetSetup",
    fetchClaudeVersions: "claude:fetchVersions",
    installClaude: "claude:install",
    cancelInstall: "claude:cancelInstall",
    openNodeDownload: "claude:openNodeDownload",
    installNode: "claude:installNode",
    fetchNodeVersions: "node:fetchVersions",
    installNodeMsi: "node:install",
    minimizeWindow: "window:minimize",
    toggleMaximizeWindow: "window:toggleMaximize",
    closeWindow: "window:close",
  };

  function tauriInvoke() {
    return window.__TAURI__?.core?.invoke
      || window.__TAURI__?.tauri?.invoke
      || window.__TAURI__?.invoke;
  }

  function tauriListen() {
    return window.__TAURI__?.event?.listen
      || window.__TAURI__?.core?.listen
      || window.__TAURI__?.event?.TauriEvent?.listen;
  }

  function backend(method) {
    return (...args) => {
      const invoke = tauriInvoke();
      if (!invoke) return Promise.resolve({ ok: false, error: "Tauri bridge missing" });
      return invoke("backend_call", { method, args })
        .catch(error => ({ ok: false, error: String(error?.message || error || "Tauri invoke failed") }));
    };
  }

  function local(command) {
    return (...args) => {
      const invoke = tauriInvoke();
      if (!invoke) return Promise.resolve({ ok: false, error: "Tauri bridge missing" });
      return invoke(command, { value: args[0] })
        .catch(error => ({ ok: false, error: String(error?.message || error || "Tauri invoke failed") }));
    };
  }

  function on(channel) {
    return (cb) => {
      const listen = tauriListen();
      if (!listen) return () => {};
      let unlisten = null;
      listen(channel, event => cb(event.payload)).then(fn => { unlisten = fn; }).catch(() => {});
      return () => { if (unlisten) unlisten(); };
    };
  }

  const bridge = {};
  for (const method of Object.keys(invokeChannels)) bridge[method] = backend(method);

  bridge.chooseFolder = () => tauriInvoke()?.("choose_folder") || Promise.resolve("");
  bridge.chooseFile = () => tauriInvoke()?.("choose_file") || Promise.resolve("");
  bridge.openPath = local("open_path");
  bridge.copyText = local("copy_text");
  bridge.minimizeWindow = () => tauriInvoke()?.("minimize_window") || Promise.resolve({ ok: false });
  bridge.toggleMaximizeWindow = () => tauriInvoke()?.("toggle_maximize_window") || Promise.resolve({ ok: false });
  bridge.closeWindow = () => tauriInvoke()?.("close_window") || Promise.resolve({ ok: false });

  bridge.onClaudeEvent = on("claude:event");
  bridge.onClaudeStderr = on("claude:stderr");
  bridge.onClaudeDone = on("claude:done");
  bridge.onAskUser = on("claude:askUser");
  bridge.onBootstrap = on("app:bootstrap");
  bridge.onProjectIndex = on("projects:index");
  bridge.onIdentityAnalysis = on("identities:analysis");
  bridge.onClaudeDetectResult = on("claude:detectResult");
  bridge.onClaudeInstallProgress = on("claude:installProgress");

  window.agentBridge = bridge;
})();
