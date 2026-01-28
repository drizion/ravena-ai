const fs = require("fs");
const path = require("path");
const Logger = require("./Logger");
const sqlite3 = require("sqlite3").verbose();

/**
 * Singleton Database class using SQLite backend with JSON storage (Hybrid approach)
 */
class Database {
	constructor() {
		this.logger = new Logger("database");
		this.databasePath = path.join(__dirname, "../../data");
		this.backupPath = path.join(__dirname, "../../data/backups");

		this.sqlites = {}; // Cache for other sqlite connections (like 'pinto')
		this.coreDb = null; // Main database connection

		this.ensureDirectories();
		this.initCoreDatabase();

		// Bot instances for cleanup on exit
		this.botInstances = [];

		// Scheduled Backup Configuration
		this.maxBackups = parseInt(process.env.MAX_BACKUPS) || 120;
		this.scheduledBackupHours = [0, 6, 12, 18];
		this.backupRetentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;

		// Directories/Files to backup
		this.backupTargets = [path.join(this.databasePath, "sqlites")];
		this.backupIgnoreFiles = ["cache.db"];

		// Shared Blocked Contacts (Global by type)
		this.globalBlockedContacts = {
			wwebjs: new Set(),
			evo: new Set(),
			evogo: new Set()
		};

		// Setup cleanup handlers
		this.setupCleanupHandlers();

		// Setup scheduled backups
		this.setupScheduledBackups();
		this.lastScheduledBackup = this.getLastScheduledBackupTime();
	}

	/**
	 * Get Singleton Instance
	 * @returns {Database}
	 */
	static getInstance() {
		if (!Database.instance) {
			Database.instance = new Database();
		}
		return Database.instance;
	}

	registerBotInstance(bot) {
		//this.logger.info(`[registerBotInstance] Registered: ${bot.id}`);
		this.botInstances.push(bot);
	}

	ensureDirectories() {
		try {
			if (!fs.existsSync(this.databasePath)) {
				fs.mkdirSync(this.databasePath, { recursive: true });
			}
			if (!fs.existsSync(this.backupPath)) {
				fs.mkdirSync(this.backupPath, { recursive: true });
			}
			const sqliteDir = path.join(this.databasePath, "sqlites");
			if (!fs.existsSync(sqliteDir)) {
				fs.mkdirSync(sqliteDir, { recursive: true });
			}
		} catch (error) {
			this.logger.error("Error ensuring database directories:", error);
		}
	}

	initCoreDatabase() {
		const dbPath = path.join(this.databasePath, "sqlites/core.db");
		this.coreDb = new sqlite3.Database(dbPath);

		// Ensure tables exist (redundant if migration ran, but good for safety)
		this.coreDb.serialize(() => {
			const tables = [
				`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, json_data TEXT)`,
				`CREATE TABLE IF NOT EXISTS custom_commands (group_id TEXT, trigger TEXT, json_data TEXT, PRIMARY KEY (group_id, trigger))`,
				`CREATE TABLE IF NOT EXISTS donations (name TEXT PRIMARY KEY, json_data TEXT)`,
				`CREATE TABLE IF NOT EXISTS pending_joins (code TEXT PRIMARY KEY, json_data TEXT)`,
				`CREATE TABLE IF NOT EXISTS soft_blocks (number TEXT PRIMARY KEY, json_data TEXT)`,
				`CREATE TABLE IF NOT EXISTS load_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT, timestamp_end INTEGER, json_data TEXT)`
			];
			tables.forEach((sql) => this.coreDb.run(sql));
		});
	}

	setupCleanupHandlers() {
		const cleanup = () => {
			this.logger.info("Closing database connections...");
			if (this.coreDb) this.coreDb.close();
			Object.values(this.sqlites).forEach((db) => db.close());

			this.botInstances.forEach((bot) => {
				try {
					bot.destroy();
				} catch (e) {}
			});
		};

		process.on("SIGINT", () => {
			cleanup();
			process.exit(0);
		});

		process.on("SIGTERM", () => {
			cleanup();
			process.exit(0);
		});
	}

	// --- Backup System ---

	setupScheduledBackups() {
		setInterval(() => {
			const now = new Date();
			const currentHour = now.getHours();

			if (this.scheduledBackupHours.includes(currentHour)) {
				const lastBackupDate = new Date(this.lastScheduledBackup);

				if (
					lastBackupDate.getDate() !== now.getDate() ||
					lastBackupDate.getMonth() !== now.getMonth() ||
					lastBackupDate.getFullYear() !== now.getFullYear() ||
					lastBackupDate.getHours() !== currentHour
				) {
					this.createScheduledBackup();
					this.lastScheduledBackup = now.getTime();
				}
			}
		}, 60000); // Check every minute
	}

	getLastScheduledBackupTime() {
		try {
			const backupInfoPath = path.join(this.backupPath, "backup-info.json");
			if (fs.existsSync(backupInfoPath)) {
				const backupInfo = JSON.parse(fs.readFileSync(backupInfoPath, "utf8"));
				return backupInfo.lastScheduledBackup || 0;
			}
		} catch (error) {
			this.logger.error("Error getting last backup info:", error);
		}
		return 0;
	}

	saveLastScheduledBackupTime(timestamp) {
		try {
			const backupInfoPath = path.join(this.backupPath, "backup-info.json");
			const backupInfo = fs.existsSync(backupInfoPath)
				? JSON.parse(fs.readFileSync(backupInfoPath, "utf8"))
				: {};

			backupInfo.lastScheduledBackup = timestamp;
			fs.writeFileSync(backupInfoPath, JSON.stringify(backupInfo, null, 2), "utf8");
		} catch (error) {
			this.logger.error("Error saving backup info:", error);
		}
	}

	createScheduledBackup() {
		try {
			const now = new Date();
			const timestamp = now.toISOString().replace(/[:.]/g, "-");
			const backupDir = path.join(this.backupPath, timestamp);

			if (!fs.existsSync(backupDir)) {
				fs.mkdirSync(backupDir, { recursive: true });
			}

			// Backup targeted files/directories
			for (const target of this.backupTargets) {
				if (fs.existsSync(target)) {
					const dest = path.join(backupDir, path.basename(target));
					this.backupDirectory(target, dest);
				}
			}

			this.logger.info(`Scheduled backup created: ${backupDir}`);
			this.saveLastScheduledBackupTime(now.getTime());
			this.cleanupOldScheduledBackups();
		} catch (error) {
			this.logger.error("Error creating scheduled backup:", error);
		}
	}

	backupDirectory(source, target) {
		try {
			if (this.backupIgnoreFiles.includes(path.basename(source))) return;

			const stats = fs.statSync(source);
			if (stats.isDirectory()) {
				if (!fs.existsSync(target)) {
					fs.mkdirSync(target, { recursive: true });
				}
				const items = fs.readdirSync(source);
				for (const item of items) {
					this.backupDirectory(path.join(source, item), path.join(target, item));
				}
			} else if (stats.isFile()) {
				fs.copyFileSync(source, target);
			}
		} catch (error) {
			this.logger.error(`Error backing up ${source}:`, error);
		}
	}

	cleanupOldScheduledBackups() {
		try {
			const now = Date.now();
			const retentionPeriod = this.backupRetentionDays * 24 * 60 * 60 * 1000;

			const backupDirs = fs
				.readdirSync(this.backupPath)
				.filter((item) => {
					const fullPath = path.join(this.backupPath, item);
					return (
						fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(item)
					);
				})
				.map((dir) => ({
					name: dir,
					path: path.join(this.backupPath, dir),
					date: new Date(
						dir.replace(/-/g, (m, i) => (i <= 10 ? m : i === 11 ? ":" : i === 14 ? ":" : "."))
					).getTime()
				}))
				.sort((a, b) => b.date - a.date);

			if (backupDirs.length > this.maxBackups) {
				const dirsToDelete = backupDirs.slice(this.maxBackups);
				for (const dir of dirsToDelete) {
					if (now - dir.date > retentionPeriod) {
						this.deleteDirectory(dir.path);
						this.logger.info(`Old backup removed: ${dir.name}`);
					}
				}
			}
		} catch (error) {
			this.logger.error("Error cleaning up old backups:", error);
		}
	}

	deleteDirectory(dirPath) {
		try {
			if (fs.existsSync(dirPath)) {
				const items = fs.readdirSync(dirPath);
				for (const item of items) {
					const itemPath = path.join(dirPath, item);
					if (fs.statSync(itemPath).isDirectory()) {
						this.deleteDirectory(itemPath);
					} else {
						fs.unlinkSync(itemPath);
					}
				}
				fs.rmdirSync(dirPath);
			}
		} catch (error) {
			this.logger.error(`Error deleting directory ${dirPath}:`, error);
		}
	}

	// --- Global Blocked Contacts ---

	addBlockedContacts(type, contacts) {
		if (!this.globalBlockedContacts[type]) {
			this.logger.warn(`Unknown bot type for blocked contacts: ${type}`);
			return;
		}
		if (!Array.isArray(contacts)) return;

		contacts.forEach((contact) => {
			if (typeof contact === "string") {
				this.globalBlockedContacts[type].add(contact);
			}
		});
		// this.logger.info(`[Database] Updated ${type} blocked contacts. Total: ${this.globalBlockedContacts[type].size}`);
	}

	isBlocked(type, contactId) {
		if (!this.globalBlockedContacts[type]) return false;
		return this.globalBlockedContacts[type].has(contactId);
	}

	// --- Core SQLite Helpers ---

	/**
	 * Run a SQL query on the core database
	 */
	run(sql, params = []) {
		return new Promise((resolve, reject) => {
			this.coreDb.run(sql, params, function (err) {
				if (err) reject(err);
				else resolve(this);
			});
		});
	}

	/**
	 * Get all rows from the core database
	 */
	all(sql, params = []) {
		return new Promise((resolve, reject) => {
			this.coreDb.all(sql, params, (err, rows) => {
				if (err) reject(err);
				else resolve(rows);
			});
		});
	}

	/**
	 * Get a single row from the core database
	 */
	get(sql, params = []) {
		return new Promise((resolve, reject) => {
			this.coreDb.get(sql, params, (err, row) => {
				if (err) reject(err);
				else resolve(row);
			});
		});
	}

	// --- Groups ---

	async getGroups() {
		try {
			const rows = await this.all("SELECT json_data FROM groups");
			return rows.map((row) => JSON.parse(row.json_data));
		} catch (error) {
			this.logger.error("Error in getGroups:", error);
			return [];
		}
	}

	async getGroup(groupId) {
		try {
			const row = await this.get("SELECT json_data FROM groups WHERE id = ?", [groupId]);
			return row ? JSON.parse(row.json_data) : null;
		} catch (error) {
			this.logger.error("Error in getGroup:", error);
			return null;
		}
	}

	async getGroupByName(groupName) {
		try {
			// Note: This matches exact name. SQLite LIKE could be used for case-insensitive if needed.
			const row = await this.get("SELECT json_data FROM groups WHERE name = ?", [groupName]);
			return row ? JSON.parse(row.json_data) : null;
		} catch (error) {
			this.logger.error("Error in getGroupByName:", error);
			return null;
		}
	}

	async saveGroup(group) {
		try {
			await this.run(
				`INSERT INTO groups (id, name, json_data) VALUES (?, ?, ?) 
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, json_data=excluded.json_data`,
				[group.id, group.name, JSON.stringify(group)]
			);
			return true;
		} catch (error) {
			this.logger.error("Error saving group:", error);
			return false;
		}
	}

	// --- Custom Commands ---

	async getCustomCommands(groupId) {
		try {
			const rows = await this.all("SELECT json_data FROM custom_commands WHERE group_id = ?", [
				groupId
			]);
			return rows.map((row) => JSON.parse(row.json_data));
		} catch (error) {
			this.logger.error("Error in getCustomCommands:", error);
			return [];
		}
	}

	async saveCustomCommand(groupId, command) {
		try {
			await this.run(
				`INSERT INTO custom_commands (group_id, trigger, json_data) VALUES (?, ?, ?)
         ON CONFLICT(group_id, trigger) DO UPDATE SET json_data=excluded.json_data`,
				[groupId, command.startsWith, JSON.stringify(command)]
			);
			return true;
		} catch (error) {
			this.logger.error("Error saving custom command:", error);
			return false;
		}
	}

	async updateCustomCommand(groupId, command) {
		// Alias for saveCustomCommand since we use ON CONFLICT UPDATE
		return this.saveCustomCommand(groupId, command);
	}

	async deleteCustomCommand(groupId, commandStart) {
		try {
			// We implement soft delete as per previous logic
			const row = await this.get(
				"SELECT json_data FROM custom_commands WHERE group_id = ? AND trigger = ?",
				[groupId, commandStart]
			);
			if (row) {
				const command = JSON.parse(row.json_data);
				command.deleted = true;
				command.active = false;
				await this.saveCustomCommand(groupId, command);
				return true;
			}
			return false;
		} catch (error) {
			this.logger.error("Error deleting custom command:", error);
			return false;
		}
	}

	async getCustomVariables() {
		try {
			const filePath = path.join(this.databasePath, "custom-variables.json");
			if (fs.existsSync(filePath)) {
				return JSON.parse(fs.readFileSync(filePath, "utf8"));
			}
			return {};
		} catch (error) {
			this.logger.error("Error getting custom variables:", error);
			return {};
		}
	}

	async saveCustomVariables(variables) {
		try {
			const filePath = path.join(this.databasePath, "custom-variables.json");
			fs.writeFileSync(filePath, JSON.stringify(variables, null, 2));
			return true;
		} catch (error) {
			this.logger.error("Error saving custom variables:", error);
			return false;
		}
	}

	// --- Load Reports ---

	async getLoadReports(since = 0) {
		try {
			const rows = await this.all("SELECT json_data FROM load_reports WHERE timestamp_end > ?", [
				since
			]);
			return rows.map((row) => JSON.parse(row.json_data));
		} catch (error) {
			this.logger.error("Error getting load reports:", error);
			return [];
		}
	}

	async saveLoadReports(reports) {
		try {
			// Start transaction
			await this.run("BEGIN TRANSACTION");
			await this.run("DELETE FROM load_reports");

			const stmt = this.coreDb.prepare(
				"INSERT INTO load_reports (bot_id, timestamp_end, json_data) VALUES (?, ?, ?)"
			);
			reports.forEach((report) => {
				stmt.run(report.botId, report.period?.end || 0, JSON.stringify(report));
			});
			stmt.finalize();

			await this.run("COMMIT");
			return true;
		} catch (error) {
			this.logger.error("Error saving load reports:", error);
			try {
				await this.run("ROLLBACK");
			} catch (e) {}
			return false;
		}
	}

	async addLoadReport(report) {
		try {
			await this.run(
				"INSERT INTO load_reports (bot_id, timestamp_end, json_data) VALUES (?, ?, ?)",
				[report.botId, report.period?.end || 0, JSON.stringify(report)]
			);

			return true;
		} catch (error) {
			this.logger.error("Error adding load report:", error);
			return false;
		}
	}

	// --- Donations ---

	async getDonations() {
		try {
			const rows = await this.all("SELECT json_data FROM donations");
			return rows.map((row) => JSON.parse(row.json_data));
		} catch (error) {
			this.logger.error("Error getting donations:", error);
			return [];
		}
	}

	async saveDonations(donations) {
		try {
			await this.run("BEGIN TRANSACTION");
			await this.run("DELETE FROM donations");
			const stmt = this.coreDb.prepare("INSERT INTO donations (name, json_data) VALUES (?, ?)");
			donations.forEach((d) => {
				stmt.run(d.nome, JSON.stringify(d));
			});
			stmt.finalize();
			await this.run("COMMIT");
			return true;
		} catch (error) {
			this.logger.error("Error saving donations:", error);
			try {
				await this.run("ROLLBACK");
			} catch (e) {}
			return false;
		}
	}

	async addDonation(name, amount, numero = undefined) {
		try {
			const row = await this.get(
				"SELECT name, json_data FROM donations WHERE name = ? COLLATE NOCASE",
				[name]
			);

			let donor;
			const now = Date.now();
			const historyEntry = { ts: now, valor: amount };
			let donationTotal;

			if (row) {
				donor = JSON.parse(row.json_data);
				donor.valor += amount;
				donor.timestamp = now;
				if (!donor.historico) donor.historico = [];
				donor.historico.push(historyEntry);
				if (numero) donor.numero = numero;
				donationTotal = donor.valor;
			} else {
				donor = {
					nome: name,
					valor: amount,
					numero,
					timestamp: now,
					historico: [historyEntry]
				};
				donationTotal = amount;
			}

			// Save back
			await this.run("INSERT OR REPLACE INTO donations (name, json_data) VALUES (?, ?)", [
				donor.nome,
				JSON.stringify(donor)
			]);

			return donationTotal === 0 ? true : donationTotal;
		} catch (error) {
			this.logger.error("Error adding donation:", error);
			return false;
		}
	}

	async updateDonorNumber(name, numero) {
		try {
			const row = await this.get("SELECT json_data FROM donations WHERE name = ? COLLATE NOCASE", [
				name
			]);
			if (!row) {
				this.logger.warn(`Donor "${name}" not found`);
				return false;
			}

			const donor = JSON.parse(row.json_data);
			donor.numero = numero;

			await this.run("INSERT OR REPLACE INTO donations (name, json_data) VALUES (?, ?)", [
				donor.nome,
				JSON.stringify(donor)
			]);
			return true;
		} catch (error) {
			this.logger.error("Error updating donor number:", error);
			return false;
		}
	}

	async updateDonationAmount(name, amount) {
		try {
			const row = await this.get("SELECT json_data FROM donations WHERE name = ? COLLATE NOCASE", [
				name
			]);
			let donor;
			const now = Date.now();
			const historyEntry = { ts: now, valor: amount };

			if (!row) {
				if (amount > 0) {
					donor = {
						nome: name,
						valor: amount,
						timestamp: now,
						historico: [historyEntry]
					};
				} else {
					return false;
				}
			} else {
				donor = JSON.parse(row.json_data);
				donor.valor += amount;
				donor.timestamp = now;
				if (!donor.historico) donor.historico = [];
				donor.historico.push(historyEntry);
			}

			if (donor.valor <= 0) {
				await this.run("DELETE FROM donations WHERE name = ?", [donor.nome]);
				this.logger.warn(`Donor "${name}" removed.`);
			} else {
				await this.run("INSERT OR REPLACE INTO donations (name, json_data) VALUES (?, ?)", [
					donor.nome,
					JSON.stringify(donor)
				]);
			}

			return true;
		} catch (error) {
			this.logger.error("Error updating donation amount:", error);
			return false;
		}
	}

	async mergeDonors(targetName, sourceName) {
		try {
			const targetRow = await this.get(
				"SELECT json_data FROM donations WHERE name = ? COLLATE NOCASE",
				[targetName]
			);
			const sourceRow = await this.get(
				"SELECT json_data FROM donations WHERE name = ? COLLATE NOCASE",
				[sourceName]
			);

			if (!targetRow || !sourceRow) return false;

			const targetDonor = JSON.parse(targetRow.json_data);
			const sourceDonor = JSON.parse(sourceRow.json_data);

			targetDonor.valor += sourceDonor.valor;
			const sourceHistory = sourceDonor.historico || [];
			const targetHistory = targetDonor.historico || [];
			targetDonor.historico = [...targetHistory, ...sourceHistory].sort((a, b) => a.ts - b.ts);

			if (!targetDonor.numero && sourceDonor.numero) {
				targetDonor.numero = sourceDonor.numero;
			}

			if (targetDonor.historico.length > 0) {
				targetDonor.timestamp = targetDonor.historico[targetDonor.historico.length - 1].ts;
			} else if (
				sourceDonor.timestamp &&
				(!targetDonor.timestamp || sourceDonor.timestamp > targetDonor.timestamp)
			) {
				targetDonor.timestamp = sourceDonor.timestamp;
			}

			await this.run("BEGIN TRANSACTION");
			await this.run("DELETE FROM donations WHERE name = ?", [sourceDonor.nome]);
			await this.run("INSERT OR REPLACE INTO donations (name, json_data) VALUES (?, ?)", [
				targetDonor.nome,
				JSON.stringify(targetDonor)
			]);
			await this.run("COMMIT");

			return true;
		} catch (error) {
			this.logger.error("Error merging donors:", error);
			try {
				await this.run("ROLLBACK");
			} catch (e) {}
			return false;
		}
	}

	// --- Pending Joins ---

	async getPendingJoins() {
		try {
			const rows = await this.all("SELECT json_data FROM pending_joins");
			return rows.map((row) => JSON.parse(row.json_data));
		} catch (error) {
			this.logger.error("Error getting pending joins:", error);
			return [];
		}
	}

	async savePendingJoins(joins) {
		try {
			await this.run("BEGIN TRANSACTION");
			await this.run("DELETE FROM pending_joins");
			const stmt = this.coreDb.prepare("INSERT INTO pending_joins (code, json_data) VALUES (?, ?)");
			joins.forEach((j) => {
				stmt.run(j.code, JSON.stringify(j));
			});
			stmt.finalize();
			await this.run("COMMIT");
			return true;
		} catch (error) {
			this.logger.error("Error saving pending joins:", error);
			try {
				await this.run("ROLLBACK");
			} catch (e) {}
			return false;
		}
	}

	async savePendingJoin(inviteCode, data) {
		try {
			// Upsert
			const joinData = {
				code: inviteCode,
				authorId: data.authorId,
				authorName: data.authorName,
				timestamp: Date.now()
			};

			await this.run("INSERT OR REPLACE INTO pending_joins (code, json_data) VALUES (?, ?)", [
				inviteCode,
				JSON.stringify(joinData)
			]);
			return true;
		} catch (error) {
			this.logger.error("Error saving pending join:", error);
			return false;
		}
	}

	async removePendingJoin(inviteCode) {
		try {
			await this.run("DELETE FROM pending_joins WHERE code = ?", [inviteCode]);
			return true;
		} catch (error) {
			this.logger.error("Error removing pending join:", error);
			return false;
		}
	}

	// --- Soft Blocks ---

	async getSoftblocks() {
		try {
			const rows = await this.all("SELECT json_data FROM soft_blocks");
			return rows.map((row) => JSON.parse(row.json_data));
		} catch (error) {
			this.logger.error("Error getting softblocks:", error);
			return [];
		}
	}

	async toggleUserInvites(phoneNumber, block) {
		try {
			const row = await this.get("SELECT json_data FROM soft_blocks WHERE number = ?", [
				phoneNumber
			]);
			let user = row ? JSON.parse(row.json_data) : null;

			if (block) {
				if (!user) {
					user = { numero: phoneNumber, invites: true };
				} else {
					user.invites = true;
				}
				await this.run("INSERT OR REPLACE INTO soft_blocks (number, json_data) VALUES (?, ?)", [
					phoneNumber,
					JSON.stringify(user)
				]);
			} else {
				if (user) {
					await this.run("DELETE FROM soft_blocks WHERE number = ?", [phoneNumber]);
				}
			}
			return true;
		} catch (error) {
			this.logger.error("Error toggling user invites:", error);
			return false;
		}
	}

	async isUserInviteBlocked(phoneNumber) {
		try {
			const row = await this.get("SELECT json_data FROM soft_blocks WHERE number = ?", [
				phoneNumber
			]);
			return row ? JSON.parse(row.json_data).invites : false;
		} catch (error) {
			this.logger.error("Error checking user invite block:", error);
			return false;
		}
	}

	// --- File System Helpers (Legacy/Compatibility) ---

	loadJSON(filePath, debug = true) {
		try {
			if (!fs.existsSync(filePath)) {
				if (debug) this.logger.debug(`File does not exist: ${filePath}`);
				return null;
			}
			const data = fs.readFileSync(filePath, "utf8");
			if (!data || data.trim() === "") return null;
			return JSON.parse(data);
		} catch (error) {
			if (debug) this.logger.error(`Error loading JSON from ${filePath}:`, error);
			return null;
		}
	}

	saveJSONToFile(filePath, data) {
		try {
			const dir = path.dirname(filePath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

			const tempFilePath = `${filePath}.tmp`;
			fs.writeFileSync(tempFilePath, JSON.stringify(data, null, 2), "utf8");
			fs.renameSync(tempFilePath, filePath);
			return true;
		} catch (error) {
			this.logger.error(`Error saving JSON to ${filePath}:`, error);
			return false;
		}
	}

	// --- Compatibility / Legacy Methods ---

	clearCache(key) {
		// No-op as cache is removed
	}

	async forcePersist() {
		// No-op as we write directly
		return true;
	}

	// --- Other SQLite Databases (Legacy/Specific) ---

	getSQLiteDb(name, schema) {
		if (!this.sqlites[name]) {
			this.logger.info(`[database][getSQLiteDb] Loading SQLite DB '${name}'`);

			const databasesFolder = path.join(this.databasePath, "sqlites");
			if (!fs.existsSync(databasesFolder)) {
				fs.mkdirSync(databasesFolder, { recursive: true });
			}

			const dbPath = path.join(databasesFolder, `${name}.db`);
			this.sqlites[name] = new sqlite3.Database(dbPath);

			// Initialize database structure
			this.sqlites[name].serialize(() => {
				this.sqlites[name].exec(schema, (err) => {
					if (err) {
						this.logger.error(`Error initializing base ${name}:`, { schema, err });
					}
				});
			});
		}

		return this.sqlites[name];
	}

	dbRun(dbName, sql, params = []) {
		const db = this.sqlites[dbName];
		return new Promise((resolve, reject) => {
			db.run(sql, params, function (err) {
				if (err) reject(err);
				else resolve(this);
			});
		});
	}

	dbAll(dbName, sql, params = []) {
		const db = this.sqlites[dbName];
		return new Promise((resolve, reject) => {
			db.all(sql, params, (err, rows) => {
				if (err) reject(err);
				else resolve(rows);
			});
		});
	}

	dbGet(dbName, sql, params = []) {
		const db = this.sqlites[dbName];
		return new Promise((resolve, reject) => {
			db.get(sql, params, (err, row) => {
				if (err) reject(err);
				else resolve(row);
			});
		});
	}
}

module.exports = Database;
