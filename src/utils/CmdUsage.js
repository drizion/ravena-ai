const Database = require("./Database");
const Logger = require("./Logger");

class CmdUsage {
	constructor() {
		this.logger = new Logger("cmd-usage");
		this.database = Database.getInstance();
		this.dbName = "cmd_usage";

		// Initialize database tables
		this.database.getSQLiteDb(
			this.dbName,
			`
      CREATE TABLE IF NOT EXISTS cmd_usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        command TEXT NOT NULL,
        user TEXT NOT NULL,
        group_id TEXT,
        args TEXT,
        return_data TEXT
      );
      
      CREATE TABLE IF NOT EXISTS cmd_usage_fixed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        command TEXT NOT NULL,
        user TEXT NOT NULL,
        group_id TEXT,
        args TEXT,
        info TEXT
      );
    `,
			true
		);
	}

	/**
	 * Get the singleton instance
	 * @returns {CmdUsage}
	 */
	static getInstance() {
		if (!CmdUsage.instance) {
			CmdUsage.instance = new CmdUsage();
		}
		return CmdUsage.instance;
	}

	/**
	 * Log a command execution to the full registry
	 * @param {Object} data
	 * @param {number} data.timestamp
	 * @param {string} data.type - 'superadmin' | 'management' | 'fixed' | 'custom'
	 * @param {string} data.command
	 * @param {string} data.user
	 * @param {string} [data.groupId]
	 * @param {string} [data.args]
	 * @param {string} [data.returnData]
	 */
	async logCommand(data) {
		try {
			const { timestamp, type, command, user, groupId, args, returnData } = data;

			// Truncate args and returnData if necessary
			const truncatedArgs = this._truncateString(args, 100);
			const truncatedReturnData = this._truncateString(returnData, 100);

			await this.database.dbRun(
				this.dbName,
				`
        INSERT INTO cmd_usage_log (timestamp, type, command, user, group_id, args, return_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
				[timestamp, type, command, user, groupId, truncatedArgs, truncatedReturnData]
			);

			// this.logger.debug(`Logged command: ${command} (${type})`);
		} catch (error) {
			this.logger.error("Error logging command:", error);
		}
	}

	/**
	 * Log detailed usage for fixed commands
	 * @param {Object} data
	 * @param {number} data.timestamp
	 * @param {string} data.command
	 * @param {string} data.user
	 * @param {string} [data.groupId]
	 * @param {string} [data.args]
	 * @param {Object} data.info - JSON object to be stringified
	 */
	async logFixedCommandUsage(data) {
		try {
			const { timestamp, command, user, groupId, args, info } = data;

			const truncatedArgs = this._truncateString(args, 100);
			const infoString = JSON.stringify(info);

			await this.database.dbRun(
				this.dbName,
				`
        INSERT INTO cmd_usage_fixed (timestamp, command, user, group_id, args, info)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
				[timestamp, command, user, groupId, truncatedArgs, infoString]
			);

			// this.logger.debug(`Logged fixed command usage: ${command}`);
		} catch (error) {
			this.logger.error("Error logging fixed command usage:", error);
		}
	}

	/**
	 * Get command usage logs
	 * @param {Object} [filters]
	 * @param {string} [filters.command]
	 * @param {string} [filters.type]
	 * @param {string} [filters.user]
	 * @param {string} [filters.groupId]
	 * @param {number} [filters.limit=100]
	 * @param {number} [filters.offset=0]
	 * @returns {Promise<Array>}
	 */
	async getUsageLogs(filters = {}) {
		try {
			let sql = "SELECT * FROM cmd_usage_log";
			const params = [];
			const conditions = [];

			if (filters.command) {
				conditions.push("command = ?");
				params.push(filters.command);
			}
			if (filters.type) {
				conditions.push("type = ?");
				params.push(filters.type);
			}
			if (filters.user) {
				conditions.push("user = ?");
				params.push(filters.user);
			}
			if (filters.groupId) {
				conditions.push("group_id = ?");
				params.push(filters.groupId);
			}

			if (conditions.length > 0) {
				sql += " WHERE " + conditions.join(" AND ");
			}

			sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
			params.push(filters.limit || 100);
			params.push(filters.offset || 0);

			return await this.database.dbAll(this.dbName, sql, params);
		} catch (error) {
			this.logger.error("Error getting usage logs:", error);
			return [];
		}
	}

	/**
	 * Get fixed command specific usage logs
	 * @param {Object} [filters]
	 * @param {string} [filters.command]
	 * @param {string} [filters.user]
	 * @param {string} [filters.groupId]
	 * @param {number} [filters.limit=100]
	 * @param {number} [filters.offset=0]
	 * @returns {Promise<Array>}
	 */
	async getFixedUsageLogs(filters = {}) {
		try {
			let sql = "SELECT * FROM cmd_usage_fixed";
			const params = [];
			const conditions = [];

			if (filters.command) {
				conditions.push("command = ?");
				params.push(filters.command);
			}
			if (filters.user) {
				conditions.push("user = ?");
				params.push(filters.user);
			}
			if (filters.groupId) {
				conditions.push("group_id = ?");
				params.push(filters.groupId);
			}

			if (conditions.length > 0) {
				sql += " WHERE " + conditions.join(" AND ");
			}

			sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
			params.push(filters.limit || 100);
			params.push(filters.offset || 0);

			const rows = await this.database.dbAll(this.dbName, sql, params);

			// Parse info JSON
			return rows.map((row) => {
				try {
					return { ...row, info: JSON.parse(row.info) };
				} catch (e) {
					return row;
				}
			});
		} catch (error) {
			this.logger.error("Error getting fixed usage logs:", error);
			return [];
		}
	}

	/**
	 * Truncate string to limit, keeping start and end
	 * @param {string} str
	 * @param {number} limit
	 * @returns {string}
	 */
	_truncateString(str, limit) {
		if (!str) return "";
		if (typeof str !== "string") str = String(str);
		if (str.length <= limit * 2) return str;

		return str.substring(0, limit) + "[...]" + str.substring(str.length - limit);
	}
}

module.exports = CmdUsage;
