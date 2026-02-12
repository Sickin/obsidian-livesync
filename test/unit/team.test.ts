import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { generateHarness, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ModuleTeamSync } from "../../src/modules/features/TeamSync/ModuleTeamSync";
import { TeamConfigManager } from "../../src/modules/features/TeamSync/TeamConfigManager";
import { createDefaultTeamConfig, type TeamConfig, TEAM_CONFIG_ID } from "../../src/modules/features/TeamSync/types";
import { CouchDBUserManager } from "../../src/modules/features/TeamSync/CouchDBUserManager";
import { TeamValidation } from "../../src/modules/features/TeamSync/ValidationFunction";

describe("ModuleTeamSync", async () => {
    let harness: LiveSyncHarness;
    const vaultName = "TestVaultTeam" + Date.now();

    beforeAll(async () => {
        harness = await generateHarness(vaultName);
        await waitForReady(harness);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    it("should be registered as a module", () => {
        const module = harness.plugin.getModule(ModuleTeamSync);
        expect(module).toBeDefined();
        expect(module).toBeInstanceOf(ModuleTeamSync);
    });

    it("should report team mode as disabled by default", () => {
        const module = harness.plugin.getModule(ModuleTeamSync);
        expect(module.isTeamModeEnabled()).toBe(false);
    });
});

describe("TeamConfigManager", async () => {
    let harness: LiveSyncHarness;
    let configManager: TeamConfigManager;
    const vaultName = "TestVaultTeamConfig" + Date.now();

    beforeAll(async () => {
        harness = await generateHarness(vaultName, {
            couchDB_USER: "admin-user",
        });
        await waitForReady(harness);
        configManager = new TeamConfigManager(harness.plugin.localDatabase);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    it("should return null when no team config exists", async () => {
        const config = await configManager.getConfig();
        expect(config).toBeNull();
    });

    it("should create a new team config", async () => {
        const config = createDefaultTeamConfig("Test Team", "admin-user");
        const saved = await configManager.saveConfig(config);
        expect(saved).toBe(true);
    });

    it("should read back the saved team config", async () => {
        const config = await configManager.getConfig();
        expect(config).not.toBeNull();
        expect(config!.teamName).toBe("Test Team");
        expect(config!.members["admin-user"].role).toBe("admin");
    });

    it("should update an existing config", async () => {
        const config = await configManager.getConfig();
        expect(config).not.toBeNull();
        config!.members["new-user"] = { role: "editor" };
        const saved = await configManager.saveConfig(config!);
        expect(saved).toBe(true);

        const updated = await configManager.getConfig();
        expect(updated!.members["new-user"].role).toBe("editor");
    });

    it("should add a member", async () => {
        await configManager.addMember("viewer-user", "viewer");
        const config = await configManager.getConfig();
        expect(config!.members["viewer-user"].role).toBe("viewer");
    });

    it("should update a member role", async () => {
        await configManager.updateMemberRole("viewer-user", "editor");
        const config = await configManager.getConfig();
        expect(config!.members["viewer-user"].role).toBe("editor");
    });

    it("should remove a member", async () => {
        await configManager.removeMember("viewer-user");
        const config = await configManager.getConfig();
        expect(config!.members["viewer-user"]).toBeUndefined();
    });
});

describe("CouchDBUserManager", () => {
    it("should build correct user document", () => {
        const doc = CouchDBUserManager.buildUserDocument("alice", "password123", ["editor"]);
        expect(doc._id).toBe("org.couchdb.user:alice");
        expect(doc.name).toBe("alice");
        expect(doc.type).toBe("user");
        expect(doc.roles).toEqual(["editor"]);
        expect(doc.password).toBe("password123");
    });

    it("should build correct user document ID", () => {
        expect(CouchDBUserManager.userDocId("bob")).toBe("org.couchdb.user:bob");
    });

    it("should map team roles to CouchDB roles", () => {
        expect(CouchDBUserManager.teamRoleToCouchDBRoles("admin")).toEqual(["admin", "team_admin"]);
        expect(CouchDBUserManager.teamRoleToCouchDBRoles("editor")).toEqual(["team_editor"]);
        expect(CouchDBUserManager.teamRoleToCouchDBRoles("viewer")).toEqual(["team_viewer"]);
    });
});

describe("TeamValidation", () => {
    it("should generate a valid design document", () => {
        const designDoc = TeamValidation.buildDesignDocument();
        expect(designDoc._id).toBe("_design/team_validation");
        expect(designDoc.validate_doc_update).toBeDefined();
        expect(typeof designDoc.validate_doc_update).toBe("string");
    });

    it("should include viewer write restriction", () => {
        const designDoc = TeamValidation.buildDesignDocument();
        expect(designDoc.validate_doc_update).toContain("team_viewer");
        expect(designDoc.validate_doc_update).toContain("forbidden");
    });

    it("should allow viewer to write readstate docs", () => {
        const designDoc = TeamValidation.buildDesignDocument();
        expect(designDoc.validate_doc_update).toContain("readstate:");
    });

    it("should restrict team config to admins", () => {
        const designDoc = TeamValidation.buildDesignDocument();
        expect(designDoc.validate_doc_update).toContain("team:config");
        expect(designDoc.validate_doc_update).toContain("team:settings:");
        expect(designDoc.validate_doc_update).toContain("team_admin");
    });
});

describe("Team Module Integration", async () => {
    let harness: LiveSyncHarness;
    const vaultName = "TestVaultTeamIntegration" + Date.now();

    beforeAll(async () => {
        harness = await generateHarness(vaultName, {
            couchDB_USER: "test-admin",
            couchDB_PASSWORD: "test-password",
            couchDB_URI: "http://localhost:5984",
            couchDB_DBNAME: "test-team-db",
        });
        await waitForReady(harness);
    });

    afterAll(async () => {
        await harness?.dispose();
    });

    it("should start with team mode disabled", () => {
        const teamModule = harness.plugin.getModule(ModuleTeamSync);
        expect(teamModule.isTeamModeEnabled()).toBe(false);
        expect(teamModule.getCurrentUserRole()).toBeUndefined();
        expect(teamModule.isCurrentUserAdmin()).toBe(false);
    });

    it("should report correct username from settings", () => {
        const teamModule = harness.plugin.getModule(ModuleTeamSync);
        expect(teamModule.getCurrentUsername()).toBe("test-admin");
    });

    it("should be able to create a team config via configManager", async () => {
        const configManager = new TeamConfigManager(harness.plugin.localDatabase);
        const config = createDefaultTeamConfig("Integration Test Team", "test-admin");
        const saved = await configManager.saveConfig(config);
        expect(saved).toBe(true);
    });

    it("should generate valid validation function", () => {
        const designDoc = TeamValidation.buildDesignDocument();
        expect(designDoc._id).toBe("_design/team_validation");
        // Verify the function is syntactically valid JavaScript
        expect(() => new Function("return " + designDoc.validate_doc_update)).not.toThrow();
    });

    it("should build correct CouchDB user docs for each role", () => {
        const adminDoc = CouchDBUserManager.buildUserDocument(
            "alice", "pass", CouchDBUserManager.teamRoleToCouchDBRoles("admin")
        );
        expect(adminDoc.roles).toContain("team_admin");

        const editorDoc = CouchDBUserManager.buildUserDocument(
            "bob", "pass", CouchDBUserManager.teamRoleToCouchDBRoles("editor")
        );
        expect(editorDoc.roles).toContain("team_editor");

        const viewerDoc = CouchDBUserManager.buildUserDocument(
            "carol", "pass", CouchDBUserManager.teamRoleToCouchDBRoles("viewer")
        );
        expect(viewerDoc.roles).toContain("team_viewer");
    });
});
