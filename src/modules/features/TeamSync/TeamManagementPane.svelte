<script lang="ts">
    import type { TeamConfig, TeamRole } from "./types";

    type TeamPanePort = {
        teamConfig: TeamConfig | null;
        currentUsername: string;
        isAdmin: boolean;
        onInitializeTeam: (teamName: string) => Promise<void>;
        onInviteMember: (username: string, password: string, role: TeamRole) => Promise<void>;
        onChangeMemberRole: (username: string, role: TeamRole) => Promise<void>;
        onRemoveMember: (username: string) => Promise<void>;
        onResetPassword: (username: string, password: string) => Promise<void>;
    };

    type Props = {
        port: import("svelte/store").Writable<TeamPanePort | undefined>;
    };

    const { port }: Props = $props();
    const data = $derived($port);

    let newTeamName = $state("");
    let inviteUsername = $state("");
    let invitePassword = $state("");
    let inviteRole = $state<TeamRole>("editor");
    let resetPwUsername = $state("");
    let resetPwPassword = $state("");
    let statusMessage = $state("");

    async function handleInitialize() {
        if (!data || !newTeamName.trim()) return;
        await data.onInitializeTeam(newTeamName.trim());
        statusMessage = "Team created!";
        newTeamName = "";
    }

    async function handleInvite() {
        if (!data || !inviteUsername.trim() || !invitePassword.trim()) return;
        await data.onInviteMember(inviteUsername.trim(), invitePassword.trim(), inviteRole);
        statusMessage = `Invited ${inviteUsername}`;
        inviteUsername = "";
        invitePassword = "";
    }

    async function handleChangeRole(username: string, role: TeamRole) {
        if (!data) return;
        await data.onChangeMemberRole(username, role);
        statusMessage = `Updated ${username} to ${role}`;
    }

    async function handleRemove(username: string) {
        if (!data) return;
        await data.onRemoveMember(username);
        statusMessage = `Removed ${username}`;
    }

    async function handleResetPassword() {
        if (!data || !resetPwUsername.trim() || !resetPwPassword.trim()) return;
        await data.onResetPassword(resetPwUsername.trim(), resetPwPassword.trim());
        statusMessage = `Password reset for ${resetPwUsername}`;
        resetPwUsername = "";
        resetPwPassword = "";
    }

    const members = $derived.by(() => {
        if (!data?.teamConfig) return [];
        return Object.entries(data.teamConfig.members).map(([name, info]) => ({
            name,
            role: info.role,
            isCurrentUser: name === data.currentUsername,
        }));
    });
</script>

<div class="team-management">
    {#if !data}
        <p>Loading...</p>
    {:else if !data.teamConfig}
        <h3>Set Up Team Mode</h3>
        <p>Create a team to enable collaborative features.</p>
        <div class="team-setup">
            <label>
                Team Name
                <input type="text" bind:value={newTeamName} placeholder="My Research Team" />
            </label>
            <button onclick={handleInitialize} disabled={!newTeamName.trim()}>
                Create Team
            </button>
        </div>
    {:else}
        <h3>Team: {data.teamConfig.teamName}</h3>

        {#if statusMessage}
            <div class="status-message">{statusMessage}</div>
        {/if}

        <h4>Members ({members.length})</h4>
        <table class="team-members">
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {#each members as member}
                    <tr>
                        <td>
                            {member.name}
                            {#if member.isCurrentUser}
                                <span class="badge-you">(you)</span>
                            {/if}
                        </td>
                        <td>
                            {#if data.isAdmin && !member.isCurrentUser}
                                <select
                                    value={member.role}
                                    onchange={(e) =>
                                        handleChangeRole(member.name, (e.target as HTMLSelectElement).value as TeamRole)}
                                >
                                    <option value="admin">Admin</option>
                                    <option value="editor">Editor</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                            {:else}
                                {member.role}
                            {/if}
                        </td>
                        <td>
                            {#if data.isAdmin && !member.isCurrentUser}
                                <button class="mod-warning" onclick={() => handleRemove(member.name)}>
                                    Remove
                                </button>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>

        {#if data.isAdmin}
            <h4>Invite Member</h4>
            <div class="invite-form">
                <label>
                    Username
                    <input type="text" bind:value={inviteUsername} placeholder="username" />
                </label>
                <label>
                    Temporary Password
                    <input type="password" bind:value={invitePassword} placeholder="password" />
                </label>
                <label>
                    Role
                    <select bind:value={inviteRole}>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                    </select>
                </label>
                <button onclick={handleInvite} disabled={!inviteUsername.trim() || !invitePassword.trim()}>
                    Invite
                </button>
            </div>

            <h4>Reset Password</h4>
            <div class="reset-password-form">
                <label>
                    Username
                    <input type="text" bind:value={resetPwUsername} placeholder="username" />
                </label>
                <label>
                    New Password
                    <input type="password" bind:value={resetPwPassword} placeholder="new password" />
                </label>
                <button onclick={handleResetPassword} disabled={!resetPwUsername.trim() || !resetPwPassword.trim()}>
                    Reset Password
                </button>
            </div>
        {/if}
    {/if}
</div>

<style>
    .team-management {
        padding: 0.5em 0;
    }
    .team-setup, .invite-form, .reset-password-form {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
        max-width: 400px;
    }
    .team-members {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 1em;
    }
    .team-members th,
    .team-members td {
        padding: 0.4em 0.6em;
        text-align: left;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .badge-you {
        opacity: 0.5;
        font-size: 0.85em;
    }
    .status-message {
        padding: 0.3em 0.6em;
        margin-bottom: 0.5em;
        background: var(--background-modifier-success);
        border-radius: 4px;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.2em;
    }
</style>
