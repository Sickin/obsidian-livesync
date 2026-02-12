import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { generateHarness, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ModuleTeamSync } from "../../src/modules/features/TeamSync/ModuleTeamSync";
import { TeamConfigManager } from "../../src/modules/features/TeamSync/TeamConfigManager";
import { createDefaultTeamConfig, type TeamConfig, TEAM_CONFIG_ID } from "../../src/modules/features/TeamSync/types";

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
