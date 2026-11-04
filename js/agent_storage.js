// Shared storage contract across Tigo projects. Resolved only on the engine.
if (typeof C8O === "undefined") { var C8O = {}; }
if (typeof C8O.tigoAgentsDirectory !== "function") {
  C8O.tigoAgentsDirectory = function (workspaceRoot, FileClass) {
    var F = FileClass || Packages.java.io.File;
    var configured = "";
    try {
      var value = Packages.com.twinsoft.convertigo.engine.Engine.theApp.databaseObjectsManager.symbolsGetValue("assistant.agents.directory");
      configured = value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
    } catch (_noAgentsDirectorySymbol) {}
    if (!configured.length) { return new F(workspaceRoot, "agents"); }
    if (configured.indexOf("\u0000") !== -1) { throw new Error("Invalid assistant.agents.directory"); }
    var directory = new F(configured);
    if (!directory.isAbsolute()) { throw new Error("assistant.agents.directory must be an absolute path"); }
    if (directory.getParentFile() === null) { throw new Error("assistant.agents.directory must be a dedicated directory, not a filesystem root"); }
    return directory;
  };
}
// End shared storage contract.
