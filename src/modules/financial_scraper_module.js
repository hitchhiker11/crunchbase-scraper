const fs = require("fs");
const path = require("path");
const { Worker } = require('worker_threads'); // Import Worker

// --- Logging Utility ---
function logScraper(message) {
    const time = new Date().toISOString();
    // Changed prefix to MANAGER to distinguish from workers
    console.log(`[${time}] [FIN_MANAGER] ${message}`);
}

// --- Main Exportable Function - Now a Worker Manager ---
async function scrapeFinancialDetails(companiesFilePath, cookiesFilePath, outputFile, options = {}) {
    logScraper("Starting financial details scraping process (using Worker Threads)...");
    logScraper(`Companies input: ${companiesFilePath}`);
    logScraper(`Cookies input: ${cookiesFilePath}`);
    logScraper(`Output file (JSONL): ${outputFile}`);

    // Get options, provide default for worker count
    const { numberOfWorkers = 1, scraperPauseMs = 2000, pageTimeoutMs = 60000 } = options;
    logScraper(`Using ${numberOfWorkers} worker(s).`);

    let companiesData;
    let overallSuccess = true;

    try {
        // --- Load Companies Data ---
        logScraper("Loading companies data...");
        try {
            const companiesRaw = await fs.promises.readFile(companiesFilePath, "utf-8");
            companiesData = JSON.parse(companiesRaw);
            if (!Array.isArray(companiesData)) throw new Error("Companies data is not an array.");
        } catch (err) {
            logScraper(`❌ Error reading companies file ${companiesFilePath}: ${err.message}`);
            return false;
        }
        logScraper(`Loaded ${companiesData.length} companies.`);

        // --- Clear/Initialize Output File ---
        logScraper(`Initializing output file: ${outputFile}`);
        try {
            await fs.promises.writeFile(outputFile, '', 'utf-8');
        } catch (err) {
            logScraper(`❌ Error initializing output file ${outputFile}: ${err.message}`);
            return false;
        }

        // --- Split Companies into Chunks for Workers ---
        const totalCompanies = companiesData.length;
        const chunkSize = Math.ceil(totalCompanies / numberOfWorkers);
        const companyChunks = [];
        for (let i = 0; i < totalCompanies; i += chunkSize) {
            companyChunks.push(companiesData.slice(i, i + chunkSize));
        }
        logScraper(`Split ${totalCompanies} companies into ${companyChunks.length} chunk(s) for ${numberOfWorkers} worker(s).`);

        // --- Launch Workers ---
        const workerPromises = [];
        const workerPath = path.resolve(__dirname, 'financial_scraper_worker.js'); // Path to the worker script

        logScraper(`Launching ${numberOfWorkers} worker(s)...`);
        for (let i = 0; i < numberOfWorkers; i++) {
            if (!companyChunks[i] || companyChunks[i].length === 0) {
                logScraper(`No companies assigned to Worker ${i + 1}, skipping launch.`);
                continue; // Don't launch worker if no work
            }

            const workerPromise = new Promise((resolve, reject) => {
                const workerData = {
                    workerId: i + 1, // Assign an ID for logging
                    companiesChunk: companyChunks[i],
                    cookiesFilePath: cookiesFilePath, // Pass the path, worker reads it
                    options: { scraperPauseMs, pageTimeoutMs } // Pass relevant options
                };

                const worker = new Worker(workerPath, { workerData });
                let workerLogPrefix = `[WORKER ${i + 1}]`;

                worker.on('message', async (message) => {
                    switch (message.type) {
                        case 'data':
                            // Received data from worker, append to file
                            logScraper(`${workerLogPrefix} Received ${message.payload.length} rounds.`);
                            try {
                                const linesToAppend = message.payload.map(r => JSON.stringify(r)).join('\n') + '\n';
                                await fs.promises.appendFile(outputFile, linesToAppend, 'utf-8');
                            } catch (appendErr) {
                                logScraper(`❌ Error appending data from ${workerLogPrefix} to ${outputFile}: ${appendErr.message}`);
                                // Consider how to handle append errors - maybe retry? For now, log it.
                                overallSuccess = false; // Mark potential data loss
                            }
                            break;
                        case 'error':
                            // Received error message from worker
                            logScraper(`❌ ${workerLogPrefix} Reported error: ${message.payload.error} (Company: ${message.payload.name || 'N/A'})`, 'error');
                            overallSuccess = false; // Mark failure if any worker reports an error
                            break;
                        case 'done':
                            // Worker finished its chunk
                            logScraper(`✅ ${workerLogPrefix} Finished processing its chunk.`);
                            resolve({ workerId: i + 1, status: 'completed' });
                            break;
                        default:
                            logScraper(`⚠️ ${workerLogPrefix} Received unknown message type: ${message.type}`, 'warn');
                    }
                });

                worker.on('error', (err) => {
                    logScraper(`❌ ${workerLogPrefix} Crashed with error: ${err.message}`, 'error');
                    overallSuccess = false;
                    reject({ workerId: i + 1, status: 'error', error: err });
                });

                worker.on('exit', (code) => {
                    if (code !== 0) {
                        logScraper(`❌ ${workerLogPrefix} Exited with code ${code}`, 'error');
                        overallSuccess = false;
                        // Reject promise if not already resolved/rejected
                        // This ensures Promise.allSettled gets the failure
                        reject({ workerId: i + 1, status: 'exited', code: code });
                    } else {
                         logScraper(` ${workerLogPrefix} Exited successfully.`);
                         // If already resolved via 'done' message, this is fine.
                         // If not resolved, resolve here (though 'done' message is preferred)
                         resolve({ workerId: i + 1, status: 'exited_ok' });
                    }
                });

                logScraper(`Launched Worker ${i + 1}.`);
            });
            workerPromises.push(workerPromise);
        }

        // --- Wait for all workers ---
        logScraper("Waiting for all workers to complete...");
        const results = await Promise.allSettled(workerPromises);
        logScraper("All workers finished.");

        // Check results for any rejections (errors)
        results.forEach(result => {
            if (result.status === 'rejected') {
                logScraper(`Worker ${result.reason?.workerId || '?'} failed or exited abnormally.`, 'warn');
                overallSuccess = false; // Ensure overall success is false if any worker failed
            }
        });


    } catch (error) {
        logScraper(`❌ Critical error in financial scraper manager: ${error.message}`);
        overallSuccess = false;
    }

    if (overallSuccess) {
        logScraper("✅ Financial scraping process completed successfully (or with non-critical worker errors).");
    } else {
         logScraper("❌ Financial scraping process finished with errors.");
    }
    return overallSuccess; // Return final status
}

module.exports = {
    scrapeFinancialDetails
}; 