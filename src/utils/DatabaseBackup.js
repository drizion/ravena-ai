const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const Logger = require("./Logger");
const sqlite3 = require("sqlite3").verbose();

class DatabaseBackup {
	constructor(databaseInstance) {
		this.db = databaseInstance;
		this.logger = new Logger("database-backup");

		this.databasePath = path.join(__dirname, "../../data");
		this.backupPath = path.join(__dirname, "../../data/backups");

		this.maxBackups = parseInt(process.env.MAX_BACKUPS) || 120;
		this.backupRetentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;

		// Remote Backup Config
		this.remoteEnabled = process.env.SQLITE_REMOTE_BACKUP === "true";
		this.remoteServers = process.env.SQLITE_REMOTE_SERVERS
			? process.env.SQLITE_REMOTE_SERVERS.split(",")
			: [];

		this.backupIgnoreFiles = ["cache.db"];
		this.backupTargets = [path.join(this.databasePath, "sqlites")];
	}

	async createScheduledBackup() {
		try {
			const now = new Date();
			const timestamp = now.toISOString().replace(/[:.]/g, "-");
			const backupDir = path.join(this.backupPath, timestamp);

			if (!fs.existsSync(backupDir)) {
				fs.mkdirSync(backupDir, { recursive: true });
			}

			// 1. File-based Backup
			for (const target of this.backupTargets) {
				if (fs.existsSync(target)) {
					const dest = path.join(backupDir, path.basename(target));
					this.backupDirectory(target, dest);
				}
			}

			this.logger.info(`File backup created: ${backupDir}`);
			this.cleanupOldScheduledBackups();

			// 2. Remote SQL Backup (Delta-like Upsert)
			if (this.remoteEnabled) {
				await this.runRemoteBackup();
			}

			return true;
		} catch (error) {
			this.logger.error("Error creating scheduled backup:", error);
			return false;
		}
	}

	backupDirectory(source, target) {
		try {
			const baseName = path.basename(source);
			if (this.backupIgnoreFiles.includes(baseName)) return;

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

			const backupDirs = this.getSortedLocalBackups();

			if (backupDirs.length > this.maxBackups) {
				const dirsToDelete = backupDirs.slice(this.maxBackups);
				for (const dir of dirsToDelete) {
					// We still need to check date for retention
					const dirDate = new Date(
						dir.name.replace(/-/g, (m, i) =>
							i === 4 || i === 7 || i === 10 ? m : i === 13 || i === 16 ? ":" : i === 19 ? "." : m
						)
					).getTime();

					if (isNaN(dirDate) || now - dirDate > retentionPeriod) {
						this.deleteDirectory(dir.path);
						this.logger.info(`Old backup removed: ${dir.name}`);
					}
				}
			}
		} catch (error) {
			this.logger.error("Error cleaning up old backups:", error);
		}
	}

	getSortedLocalBackups() {
		if (!fs.existsSync(this.backupPath)) return [];
		return fs
			.readdirSync(this.backupPath)
			.filter((item) => {
				const fullPath = path.join(this.backupPath, item);
				return (
					fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(item)
				);
			})
			.map((dir) => ({
				name: dir,
				path: path.join(this.backupPath, dir)
			}))
			.sort((a, b) => b.name.localeCompare(a.name));
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

	// --- Remote SQL Backup ---

	async runRemoteBackup() {
		this.logger.info(`Starting remote SQL backup to ${this.remoteServers.length} servers...`);
		for (const serverUri of this.remoteServers) {
			try {
				const serverDisplay = serverUri.includes("@")
					? serverUri.split("@")[1]
					: serverUri.split("/")[2];
				this.logger.info(`Connecting to remote server: ${serverDisplay}`);
				const connection = await mysql.createConnection(serverUri);
				this.logger.info("Connection established. Starting sync...");
				await this.syncAllDatabases(connection);
				await connection.end();
				this.logger.info(`Remote backup successful for ${serverDisplay}`);
			} catch (error) {
				this.logger.error(`Failed to backup to ${serverUri}:`, error);
			}
		}
	}

	async syncAllDatabases(remoteConn) {
		// 1. Sync Core DB
		this.logger.info("Syncing Core Database...");
		await this.syncCoreDatabase(remoteConn);

		// 2. Sync other SQLite databases
		const sqlitesDir = path.join(this.databasePath, "sqlites");
		const sqliteFiles = fs
			.readdirSync(sqlitesDir)
			.filter((f) => f.endsWith(".db") && !this.backupIgnoreFiles.includes(f) && f !== "core.db");

		this.logger.info(`Found ${sqliteFiles.length} additional SQLite databases to sync.`);

		for (const file of sqliteFiles) {
			const dbName = file.replace(".db", "");
			if (this.db.noBackupDatabases && this.db.noBackupDatabases.has(dbName)) {
				this.logger.debug(`Skipping ${dbName} (no-backup flag set)`);
				continue;
			}
			this.logger.info(`Syncing database: ${dbName}`);
			await this.syncGenericSQLite(dbName, remoteConn);
		}
	}

	async syncCoreDatabase(remoteConn) {
		const tables = [
			{ name: "groups", pk: ["id"] },
			{ name: "custom_commands", pk: ["group_id", "trigger"] },
			{ name: "donations", pk: ["name"] },
			{ name: "pending_joins", pk: ["code"] },
			{ name: "soft_blocks", pk: ["number"] }
		];

		for (const table of tables) {
			this.logger.debug(`Core: Syncing table ${table.name}...`);
			await this.syncTable(this.db.coreDb, table.name, table.pk, remoteConn);
		}
	}

	async syncGenericSQLite(dbName, remoteConn) {
		try {
			let db = this.db.sqlites[dbName];

			// If not currently loaded in memory, open it temporarily
			let temporary = false;
			if (!db) {
				const dbPath = path.join(this.databasePath, "sqlites", `${dbName}.db`);
				if (!fs.existsSync(dbPath)) return;
				db = new sqlite3.Database(dbPath);
				temporary = true;
			}

			const tables = await this.getTables(db);
			this.logger.debug(`DB '${dbName}': Found ${tables.length} tables.`);

			for (const tableName of tables) {
				if (tableName.startsWith("sqlite_")) continue;
				const pks = await this.getPrimaryKeys(db, tableName);
				this.logger.debug(`DB '${dbName}': Syncing table ${tableName}...`);
				await this.syncTable(db, tableName, pks, remoteConn);
			}

			if (temporary) db.close();
		} catch (error) {
			this.logger.error(`Error syncing database ${dbName}:`, error);
		}
	}

	async getTables(db) {
		return new Promise((resolve, reject) => {
			db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
				if (err) reject(err);
				else resolve(rows.map((r) => r.name));
			});
		});
	}

	async getPrimaryKeys(db, tableName) {
		return new Promise((resolve, reject) => {
			db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
				if (err) reject(err);
				else {
					const pks = rows
						.filter((r) => r.pk > 0)
						.sort((a, b) => a.pk - b.pk)
						.map((r) => r.name);
					resolve(pks.length > 0 ? pks : ["rowid"]);
				}
			});
		});
	}

	async syncTable(sqliteDb, tableName, pks, remoteConn) {
		try {
			const createSql = await this.getRemoteCreateStatement(sqliteDb, tableName, pks);
			await remoteConn.execute(createSql);

			const rows = await new Promise((resolve, reject) => {
				sqliteDb.all(`SELECT * FROM ${tableName}`, (err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				});
			});

			if (rows.length === 0) {
				this.logger.debug(`Table ${tableName}: No rows to sync.`);
				return;
			}

			this.logger.info(`Table ${tableName}: Syncing ${rows.length} rows...`);

			const chunks = this.chunkArray(rows, 500);
			let processed = 0;
			for (const chunk of chunks) {
				await this.upsertToRemote(remoteConn, tableName, chunk, pks);
				processed += chunk.length;
				if (chunks.length > 1) {
					this.logger.debug(`Table ${tableName}: Processed ${processed}/${rows.length} rows.`);
				}
			}
		} catch (error) {
			this.logger.error(`Error syncing table ${tableName}:`, error);
		}
	}

	async getRemoteCreateStatement(sqliteDb, tableName, pks) {
		const info = await new Promise((resolve, reject) => {
			sqliteDb.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
				if (err) reject(err);
				else resolve(rows);
			});
		});

		const columns = info.map((col) => {
			let type = "TEXT";
			if (col.type.includes("INT")) type = "BIGINT";
			if (col.type.includes("REAL") || col.type.includes("DOUBLE")) type = "DOUBLE";
			if (col.type.includes("BLOB")) type = "LONGBLOB";

			if (col.name === "json_data" || col.type === "TEXT" || type === "TEXT") {
				// MySQL Primary Key columns cannot be BLOB/TEXT without length.
				// We use VARCHAR(768) for PKs and LONGTEXT for others.
				// 768 is the max safe length for utf8mb4 indexes (3072 bytes).
				if (pks.includes(col.name)) {
					type = "VARCHAR(768)";
				} else {
					type = "LONGTEXT";
				}
			}

			return `\`${col.name}\` ${type}`;
		});

		return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${columns.join(", ")}, PRIMARY KEY (${pks.map((pk) => `\`${pk}\``).join(", ")})) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
	}

	async upsertToRemote(remoteConn, tableName, rows, pks) {
		const keys = Object.keys(rows[0]);
		const values = rows.map((row) => keys.map((k) => row[k]));

		const placeholders = rows.map(() => `(${keys.map(() => "?").join(", ")})`).join(", ");
		const updateClause = keys.map((k) => `\`${k}\` = VALUES(\`${k}\`)`).join(", ");

		const sql = `INSERT INTO \`${tableName}\` (${keys.map((k) => `\`${k}\``).join(", ")}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateClause}`;

		await remoteConn.execute(sql, values.flat());
	}

	chunkArray(array, size) {
		const chunks = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}

	// --- Corruption Handling & Recovery ---

	async handleCorruption(dbName, error) {
		this.logger.error(`CORRUPTION DETECTED in database: ${dbName}`, error);

		// 1. Report to Telegram (Verbose)
		await this.reportToTelegram(`🚨 *SQLITE CORRUPT DETECTED!*
Database: \`${dbName}.db\`
Error: \`${error.message}\``);

		let backupUsed = "none";
		try {
			// 2. Backup the corrupt file
			const dbFile = dbName === "core" ? "core.db" : `${dbName}.db`;
			const dbPath = path.join(this.databasePath, "sqlites", dbFile);
			const corruptPath = `${dbPath}.corrupt-${Date.now()}`;

			if (fs.existsSync(dbPath)) {
				fs.copyFileSync(dbPath, corruptPath);
				this.logger.info(`Corrupt database saved to: ${corruptPath}`);
			}

			// Delete WAL and SHM files to ensure a clean restore
			const walPath = `${dbPath}-wal`;
			const shmPath = `${dbPath}-shm`;
			if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
			if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

			// 3. Attempt Restore from Cloud
			let restored = false;
			if (this.remoteEnabled && this.remoteServers.length > 0) {
				restored = await this.restoreFromCloud(dbName);
				if (restored) backupUsed = "cloud";
			}

			// 4. Fallback to latest Local Backup
			if (!restored) {
				const latestLocal = this.getSortedLocalBackups()[0];
				if (latestLocal) {
					const backupFilePath = path.join(latestLocal.path, "sqlites", dbFile);
					if (fs.existsSync(backupFilePath)) {
						fs.copyFileSync(backupFilePath, dbPath);
						restored = true;
						backupUsed = `file from ${latestLocal.name}`;
					}
				}
			}

			if (restored) {
				await this.reportToTelegram(`✅ *Backup Restored*
Source: \`${backupUsed}\``);

				// 5. Re-init connection
				await this.reinitConnection(dbName);

				await this.reportToTelegram(`🔄 *System Recovered*
File restored and data re-read into memory.`);
			} else {
				await this.reportToTelegram(`❌ *RESTORE FAILED*
No valid backup found (cloud or local).`);
			}
		} catch (err) {
			this.logger.error("Error during corruption recovery:", err);
			await this.reportToTelegram(`❌ *CRITICAL RECOVERY ERROR*
${err.message}`);
		}
	}

	async reportToTelegram(message) {
		for (const bot of this.db.botInstances) {
			try {
				if (bot.notificarDonate) {
					await bot.sendMessage(bot.grupoLogs || process.env.GRUPO_LOGS, message);
				}
			} catch (e) {
				this.logger.error("Failed to send report:", e);
			}
		}
	}

	async restoreFromCloud(dbName) {
		this.logger.info(`Attempting cloud restoration for ${dbName}...`);
		const schema = this.db.schemas[dbName];
		if (!schema) {
			this.logger.warn(`No schema found for ${dbName}, cloud restore might fail schema creation.`);
		}

		for (const serverUri of this.remoteServers) {
			try {
				const connection = await mysql.createConnection(serverUri);
				const remoteTables = await this.getRemoteTables(connection);

				const dbFile = dbName === "core" ? "core.db" : `${dbName}.db`;
				const dbPath = path.join(this.databasePath, "sqlites", dbFile);

				// Create a new empty SQLite to populate
				if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
				const newDb = new sqlite3.Database(dbPath);

				// 1. Initialize schema
				if (schema) {
					await new Promise((resolve, reject) => {
						newDb.exec(schema, (err) => {
							if (err) reject(err);
							else resolve();
						});
					});
				}

				// 2. Identify tables relevant to this DB
				// If it's a generic DB, we use sqlite_master to see what tables the schema created
				const localTables = await this.getTables(newDb);

				for (const table of localTables) {
					if (remoteTables.includes(table)) {
						const [rows] = await connection.execute(`SELECT * FROM \`${table}\``);
						if (rows.length > 0) {
							await this.populateSQLiteTable(newDb, table, rows);
						}
					}
				}

				newDb.close();
				await connection.end();
				return true;
			} catch (e) {
				this.logger.error(`Cloud restore failed from ${serverUri}:`, e);
			}
		}
		return false;
	}

	async getRemoteTables(conn) {
		const [rows] = await conn.execute("SHOW TABLES");
		return rows.map((r) => Object.values(r)[0]);
	}

	async populateSQLiteTable(sqliteDb, tableName, rows) {
		const keys = Object.keys(rows[0]);
		const columns = keys.map((k) => `\`${k}\``).join(", ");
		const placeholders = keys.map(() => "?").join(", ");

		const sql = `INSERT INTO \`${tableName}\` (${columns}) VALUES (${placeholders})`;

		return new Promise((resolve, reject) => {
			sqliteDb.serialize(() => {
				const stmt = sqliteDb.prepare(sql);
				for (const row of rows) {
					stmt.run(keys.map((k) => row[k]));
				}
				stmt.finalize((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		});
	}

	async reinitConnection(dbName) {
		const dbFile = dbName === "core" ? "core.db" : `${dbName}.db`;
		const dbPath = path.join(this.databasePath, "sqlites", dbFile);

		if (dbName === "core") {
			if (this.db.coreDb) this.db.coreDb.close();
			this.db.coreDb = new sqlite3.Database(dbPath);
			this.db.coreDb.run("PRAGMA journal_mode = WAL");
			this.db.coreDb.run("PRAGMA synchronous = NORMAL");
			this.db.coreDb.run("PRAGMA busy_timeout = 5000");
		} else {
			if (this.db.sqlites[dbName]) this.db.sqlites[dbName].close();
			this.db.sqlites[dbName] = new sqlite3.Database(dbPath);
			this.db.sqlites[dbName].run("PRAGMA journal_mode = WAL");
			this.db.sqlites[dbName].run("PRAGMA synchronous = NORMAL");
			this.db.sqlites[dbName].run("PRAGMA busy_timeout = 5000");
		}
		this.logger.info(`Reinitialized connection for ${dbName}`);
	}
}

module.exports = DatabaseBackup;
