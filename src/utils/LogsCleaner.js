const fs = require("fs").promises; // Using the promise-based API for fs
const path = require("path");
const cron = require("node-cron");

const logsDir = path.resolve(__dirname, "..", "..", "logs");
const historyBaseDir = path.join(logsDir, "history");

/**
 * Organizes log files by moving them into date-specific subdirectories within logs/history.
 */
async function organizeLogs() {
	const timestamp = new Date().toISOString();
	console.log(`[${timestamp}] Running log organization task...`);
	try {
		// Ensure the base history directory (logs/history) exists.
		// fs.mkdir with recursive:true will create it if it doesn't exist,
		// and won't throw an error if it already exists.
		await fs.mkdir(historyBaseDir, { recursive: true });
		// console.log(`[${timestamp}] Ensured history directory exists: ${historyBaseDir}`);

		// Read all entries (files and directories) from the logsDir
		const entries = await fs.readdir(logsDir, { withFileTypes: true });

		for (const entry of entries) {
			// We are only interested in files directly within logsDir that match the pattern.
			// entry.isFile() checks if it's a file.
			// entry.name is the file name (e.g., "2025-05-30-service1.log")
			// The regex /^\d{4}-\d{2}-\d{2}-.+\.log$/ matches "YYYY-MM-DD-anything.log"
			if (entry.isFile() && /^\d{4}-\d{2}-\d{2}-.+\.log$/.test(entry.name)) {
				const fileName = entry.name;
				const filePath = path.join(logsDir, fileName); // Full path to the source file

				// Extract the date part (YYYY-MM-DD) from the filename
				const datePart = fileName.substring(0, 10);

				// Construct the target directory path (e.g., logs/history/YYYY-MM-DD)
				const targetDateDir = path.join(historyBaseDir, datePart);

				// Construct the full path for the destination file
				const targetFilePath = path.join(targetDateDir, fileName);

				// Ensure the specific date directory (e.g., logs/history/YYYY-MM-DD) exists.
				// Again, recursive:true handles creation if it's missing.
				await fs.mkdir(targetDateDir, { recursive: true });
				// console.log(`[${timestamp}] Ensured target date directory exists: ${targetDateDir}`);

				// Move the file from its current location to the target directory
				await fs.rename(filePath, targetFilePath);
				console.log(`[${timestamp}] Moved: ${fileName} to ${targetDateDir}`);
			}
		}
		console.log(`[${timestamp}] Log organization task finished.`);
	} catch (error) {
		// Log any errors encountered during the process
		console.error(`[${timestamp}] Error during log organization:`, error);
	}
}

function start() {
	console.log("Log Cleaner service initialized. Scheduled to run daily at 00:00 (midnight).");

	// cron.schedule(cronExpression, function, options)
	// Cron expression '0 0 * * *' means:
	// - 0: at the 0th minute
	// - 0: at the 0th hour (midnight)
	// - *: every day of the month
	// - *: every month
	// - *: every day of the week
	cron.schedule(
		"0 0 * * *",
		() => {
			const timestamp = new Date().toISOString();
			console.log(`[${timestamp}] Cron job triggered: Running daily log organization.`);
			organizeLogs().catch((err) => {
				// Catch errors from the async organizeLogs function if it rejects
				console.error(`[${timestamp}] Scheduled log organization failed:`, err);
			});
		},
		{
			scheduled: true,
			timezone: "America/Sao_Paulo"
		}
	);
}

// Export the functions to be used by other parts of your application (e.g., index.js)
module.exports = {
	start,
	organizeLogs // Exposing organizeLogs allows for manual triggering if needed
};
