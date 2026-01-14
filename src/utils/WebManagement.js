const Database = require("./Database");
const Logger = require("./Logger");

class WebManagement {
	constructor() {
		this.logger = new Logger("web-management");
		this.database = Database.getInstance();
		this.DB_NAME = "web_management";

		// Initialize Database
		this.database.getSQLiteDb(
			this.DB_NAME,
			`
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        group_id TEXT,
        json_data TEXT
      );
    `
		);
	}

	static getInstance() {
		if (!WebManagement.instance) {
			WebManagement.instance = new WebManagement();
		}
		return WebManagement.instance;
	}

	async getToken(token) {
		try {
			const row = await this.database.dbGet(
				this.DB_NAME,
				"SELECT json_data FROM tokens WHERE token = ?",
				[token]
			);
			return row ? JSON.parse(row.json_data) : null;
		} catch (error) {
			this.logger.error("Error reading token:", error);
			return null;
		}
	}

	async saveToken(tokenData) {
		try {
			await this.database.dbRun(
				this.DB_NAME,
				"INSERT OR REPLACE INTO tokens (token, group_id, json_data) VALUES (?, ?, ?)",
				[tokenData.token, tokenData.groupId, JSON.stringify(tokenData)]
			);
			return true;
		} catch (error) {
			this.logger.error("Error saving token:", error);
			return false;
		}
	}
}

module.exports = WebManagement;
