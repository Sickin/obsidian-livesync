import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { generateHarness, waitForReady, type LiveSyncHarness } from "../harness/harness";
import { ModuleTeamSync } from "../../src/modules/features/TeamSync/ModuleTeamSync";

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
