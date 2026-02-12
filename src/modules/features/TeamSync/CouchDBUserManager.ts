import type { TeamRole } from "./types.ts";

interface CouchDBUserDocument {
    _id: string;
    _rev?: string;
    name: string;
    type: "user";
    roles: string[];
    password?: string;
}

/**
 * Manages CouchDB users via the _users database HTTP API.
 * Requires admin credentials to create/update/delete users.
 */
export class CouchDBUserManager {
    constructor(
        private couchDBUri: string,
        private adminCredentials: { username: string; password: string }
    ) {}

    private get authHeader(): string {
        const encoded = btoa(`${this.adminCredentials.username}:${this.adminCredentials.password}`);
        return `Basic ${encoded}`;
    }

    private get usersDbUrl(): string {
        const base = this.couchDBUri.replace(/\/+$/, "");
        const url = new URL(base);
        return `${url.origin}/_users`;
    }

    static userDocId(username: string): string {
        return `org.couchdb.user:${username}`;
    }

    static teamRoleToCouchDBRoles(role: TeamRole): string[] {
        switch (role) {
            case "admin":
                return ["admin", "team_admin"];
            case "editor":
                return ["team_editor"];
            case "viewer":
                return ["team_viewer"];
        }
    }

    static buildUserDocument(username: string, password: string, roles: string[]): CouchDBUserDocument {
        return {
            _id: CouchDBUserManager.userDocId(username),
            name: username,
            type: "user",
            roles,
            password,
        };
    }

    async createUser(username: string, password: string, role: TeamRole): Promise<boolean> {
        const roles = CouchDBUserManager.teamRoleToCouchDBRoles(role);
        const doc = CouchDBUserManager.buildUserDocument(username, password, roles);
        const url = `${this.usersDbUrl}/${encodeURIComponent(doc._id)}`;

        try {
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: this.authHeader,
                },
                body: JSON.stringify(doc),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async updateUserRole(username: string, role: TeamRole): Promise<boolean> {
        const docId = CouchDBUserManager.userDocId(username);
        const url = `${this.usersDbUrl}/${encodeURIComponent(docId)}`;

        try {
            const getResponse = await fetch(url, {
                headers: { Authorization: this.authHeader },
            });
            if (!getResponse.ok) return false;

            const existingDoc = (await getResponse.json()) as CouchDBUserDocument;
            existingDoc.roles = CouchDBUserManager.teamRoleToCouchDBRoles(role);

            const putResponse = await fetch(url, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: this.authHeader,
                },
                body: JSON.stringify(existingDoc),
            });
            return putResponse.ok;
        } catch {
            return false;
        }
    }

    async resetPassword(username: string, newPassword: string): Promise<boolean> {
        const docId = CouchDBUserManager.userDocId(username);
        const url = `${this.usersDbUrl}/${encodeURIComponent(docId)}`;

        try {
            const getResponse = await fetch(url, {
                headers: { Authorization: this.authHeader },
            });
            if (!getResponse.ok) return false;

            const existingDoc = (await getResponse.json()) as CouchDBUserDocument;
            existingDoc.password = newPassword;

            const putResponse = await fetch(url, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: this.authHeader,
                },
                body: JSON.stringify(existingDoc),
            });
            return putResponse.ok;
        } catch {
            return false;
        }
    }

    async deleteUser(username: string): Promise<boolean> {
        const docId = CouchDBUserManager.userDocId(username);
        const url = `${this.usersDbUrl}/${encodeURIComponent(docId)}`;

        try {
            const getResponse = await fetch(url, {
                headers: { Authorization: this.authHeader },
            });
            if (!getResponse.ok) return false;

            const existingDoc = (await getResponse.json()) as CouchDBUserDocument;
            const deleteUrl = `${url}?rev=${existingDoc._rev}`;

            const deleteResponse = await fetch(deleteUrl, {
                method: "DELETE",
                headers: { Authorization: this.authHeader },
            });
            return deleteResponse.ok;
        } catch {
            return false;
        }
    }

    async listUsers(): Promise<CouchDBUserDocument[]> {
        const url = `${this.usersDbUrl}/_all_docs?include_docs=true`;

        try {
            const response = await fetch(url, {
                headers: { Authorization: this.authHeader },
            });
            if (!response.ok) return [];

            const result = (await response.json()) as {
                rows: Array<{ doc: CouchDBUserDocument }>;
            };
            return result.rows
                .map((row) => row.doc)
                .filter((doc) => doc.type === "user" && doc.name);
        } catch {
            return [];
        }
    }
}
