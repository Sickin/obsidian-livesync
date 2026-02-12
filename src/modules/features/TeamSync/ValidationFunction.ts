interface CouchDBDesignDocument {
    _id: string;
    _rev?: string;
    validate_doc_update: string;
}

/**
 * Manages the CouchDB design document that enforces team role-based access.
 *
 * Role enforcement:
 * - Viewers (team_viewer role) can only write readstate: documents
 * - Editors (team_editor role) can write normal docs and annotations, but not team:config or team:settings:*
 * - Admins (team_admin role) have no restrictions
 * - CouchDB server admins bypass validation entirely (CouchDB default behavior)
 */
export class TeamValidation {
    static readonly DESIGN_DOC_ID = "_design/team_validation";

    /**
     * Build the CouchDB design document with the validation function.
     *
     * NOTE: CouchDB validate_doc_update functions are plain JavaScript strings
     * executed by CouchDB's SpiderMonkey engine. They cannot use modern JS features.
     */
    static buildDesignDocument(): CouchDBDesignDocument {
        const validateFn = `function(newDoc, oldDoc, userCtx, secObj) {
    // CouchDB admins bypass all validation
    if (userCtx.roles.indexOf('_admin') !== -1) {
        return;
    }

    // Team admins can do anything
    if (userCtx.roles.indexOf('team_admin') !== -1) {
        return;
    }

    // Viewers can only write readstate documents
    if (userCtx.roles.indexOf('team_viewer') !== -1) {
        if (newDoc._id.indexOf('readstate:') === 0) {
            return;
        }
        throw({forbidden: 'Viewers can only update read state documents'});
    }

    // Editors cannot modify team configuration
    if (userCtx.roles.indexOf('team_editor') !== -1) {
        if (newDoc._id === 'team:config') {
            throw({forbidden: 'Only admins can modify team configuration'});
        }
        if (newDoc._id.indexOf('team:settings:') === 0) {
            throw({forbidden: 'Only admins can modify team settings'});
        }
        return;
    }

    // Users without any team role — allow normal access
    // (for backward compatibility with non-team setups)
    return;
}`;

        return {
            _id: TeamValidation.DESIGN_DOC_ID,
            validate_doc_update: validateFn,
        };
    }

    /**
     * Install the validation function on the CouchDB database.
     */
    static async install(
        couchDBUri: string,
        dbName: string,
        authHeader: string
    ): Promise<boolean> {
        const designDoc = TeamValidation.buildDesignDocument();
        const base = couchDBUri.replace(/\/+$/, "");
        const url = new URL(base);
        const dbUrl = `${url.origin}/${encodeURIComponent(dbName)}`;
        const docUrl = `${dbUrl}/${encodeURIComponent(designDoc._id)}`;

        try {
            const getResponse = await fetch(docUrl, {
                headers: { Authorization: authHeader },
            });
            if (getResponse.ok) {
                const existing = await getResponse.json();
                designDoc._rev = existing._rev;
            }

            const putResponse = await fetch(docUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: authHeader,
                },
                body: JSON.stringify(designDoc),
            });
            return putResponse.ok;
        } catch {
            return false;
        }
    }

    /**
     * Remove the validation function from the database.
     */
    static async uninstall(
        couchDBUri: string,
        dbName: string,
        authHeader: string
    ): Promise<boolean> {
        const base = couchDBUri.replace(/\/+$/, "");
        const url = new URL(base);
        const dbUrl = `${url.origin}/${encodeURIComponent(dbName)}`;
        const docUrl = `${dbUrl}/${encodeURIComponent(TeamValidation.DESIGN_DOC_ID)}`;

        try {
            const getResponse = await fetch(docUrl, {
                headers: { Authorization: authHeader },
            });
            if (!getResponse.ok) return true;

            const existing = await getResponse.json();
            const deleteUrl = `${docUrl}?rev=${existing._rev}`;

            const deleteResponse = await fetch(deleteUrl, {
                method: "DELETE",
                headers: { Authorization: authHeader },
            });
            return deleteResponse.ok;
        } catch {
            return false;
        }
    }
}
