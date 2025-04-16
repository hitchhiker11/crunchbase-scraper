// --- Глобальные обработчики ошибок В САМОМ НАЧАЛЕ ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('--- [GLOBAL] UNHANDLED REJECTION ---');
  console.error('Reason:', reason);
  // console.error('Promise:', promise); // Можно раскомментировать для деталей
  process.exit(1); // Важно выйти, чтобы не зависнуть
});
process.on('uncaughtException', (error) => {
  console.error('--- [GLOBAL] UNCAUGHT EXCEPTION ---');
  console.error('Error:', error);
  process.exit(1); // Важно выйти
});
// --- Конец глобальных обработчиков ---

console.log("--- Starting src/run_pipeline.js ---");

const fs = require("fs");
console.log("--- fs required ---");
const path = require("path");
console.log("--- path required ---");
// Updated require paths relative to src/
const appModule = require('./modules/app_module.js');
console.log("--- appModule required ---");
const postprocessModule = require('./modules/postprocess_module.js');
console.log("--- postprocessModule required ---");
const mergeModule = require('./modules/merge_data_module.js');
console.log("--- mergeModule required ---");
const pivotModule = require('./modules/pivot_rounds_module.js');
console.log("--- pivotModule required ---");
const csvModule = require('./modules/to_csv_module.js');
console.log("--- csvModule required ---");
const financialScraperModule = require('./modules/financial_scraper_module.js');
console.log("--- financialScraperModule required ---");

// Updated config path relative to project root (where node is run)
const CONFIG_FILE = "config/pipeline_config.json";
console.log("--- CONFIG_FILE defined ---");
const PROJECT_ROOT = process.cwd(); // Get project root directory
console.log("--- PROJECT_ROOT defined ---");

// --- Определим delay здесь, в области видимости модуля ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Utility Functions ---
function logPipeline(message, level = "info") {
     try {
        const time = new Date().toISOString();
        const prefix = level === "error" ? "❌" : (level === "warn" ? "⚠️" : "✅");
        console.log(`[${time}] [PIPELINE ${level.toUpperCase()}] ${prefix} ${message}`);
    } catch (logError) {
        console.error("!!!!!! ERROR WITHIN logPipeline ITSELF !!!!!!");
        console.error(logError);
    }
}
console.log("--- Utility functions defined ---");
async function fileExists(filePath) {
    // Resolve path before checking
    const absolutePath = path.resolve(PROJECT_ROOT, filePath);
    try {
        await fs.promises.access(absolutePath, fs.constants.F_OK);
        return true;
    } catch (e) {
        return false;
    }
}
// Updated deleteFile to resolve path from root
async function deleteFile(relativePath, fileNameForLog) {
    const filePath = path.resolve(PROJECT_ROOT, relativePath); // Ensure absolute path
    try {
        if (await fileExists(filePath)) {
            await fs.promises.unlink(filePath);
            logPipeline(`Deleted intermediate file: ${fileNameForLog} (${relativePath})`);
        } else {
            logPipeline(`Intermediate file not found, skipping deletion: ${fileNameForLog} (${relativePath})`, "warn");
        }
        return true;
    } catch (err) {
        logPipeline(`Failed to delete file ${fileNameForLog} (${relativePath}): ${err.message}`, "error");
        return false;
    }
}

// --- Updated check function ---
async function checkInputFileExists(filePath, stepName, isOptional = false) {
    if (!(await fileExists(filePath))) {
        const message = `Required input file '${filePath}' for step '${stepName}' not found.`;
        if (isOptional) {
            logPipeline(message + " Proceeding without it.", "warn");
            return false; // Indicate file is missing but optional
        } else {
            logPipeline(message + " Ensure previous steps ran or required files exist.", "error");
            throw new Error(message); // Stop pipeline if required file is missing
        }
    }
     logPipeline(`Input file check passed for '${filePath}' for step '${stepName}'.`);
    return true; // Indicate file exists
}

// --- Main Pipeline Logic ---
console.log("--- runPipeline function entered ---");
async function runPipeline() {
    logPipeline("Starting pipeline execution...");
    let config;
    const configPath = path.resolve(PROJECT_ROOT, CONFIG_FILE);
    try {
        logPipeline(`Loading configuration from: ${configPath}`);
        const configRaw = await fs.promises.readFile(configPath, "utf-8");
        config = JSON.parse(configRaw);
        logPipeline("Configuration loaded successfully.");
    } catch (err) {
        console.error("--- ERROR occurred during config loading ---");
        logPipeline(`Failed to load configuration file ${configPath || CONFIG_FILE}: ${err.message}`, "error");
        console.error(err);
        process.exit(1);
    }

    const status = { // Initialize status object
        companiesScraped: false,
        financialsScraped: false,
        companiesProcessed: false,
        mergedLong: false,
        pivotedWide: false,
        csvLongGenerated: false,
        csvWideGenerated: false,
        overallSuccess: true
    };
    const paths = { ...config.inputFilePaths, ...config.outputFilePaths };

    console.log("--- Status and paths initialized ---");

    console.log("--- Immediately before main try block ---");

    try {
        console.log("--- Immediately inside main try block ---");
        logPipeline("Entering main pipeline steps...");

        // --- Step: Run Companies Scraper ---
        logPipeline("--- Evaluating Step: Companies Scraper ---");
        if (config.stepsToRun.runCompaniesScraper) {
            logPipeline("Step: Running Companies Scraper...");
            await checkInputFileExists(paths.cookies, "Companies Scraper");
            const success = await appModule.runScraper('companies', config);
            if (success) { status.companiesScraped = true; logPipeline("Step: Companies Scraper finished successfully."); }
            else { throw new Error("Companies Scraper failed."); }
        } else {
            logPipeline("[Skip Logic] Skipping Companies Scraper (disabled). Checking for existing output...");
            try {
                const exists = await fileExists(paths.rawCompaniesOutput);
                logPipeline(`[Skip Logic] fileExists check for ${paths.rawCompaniesOutput} returned: ${exists}`);
                if (exists) {
                    status.companiesScraped = true;
                    logPipeline("[Skip Logic] Found existing output file, marking step as complete.");
                } else {
                    logPipeline("[Skip Logic] Output file not found, step remains incomplete.", "warn");
                }
            } catch(feError) {
                logPipeline(`[Skip Logic] Error checking file existence for skipped step Companies Scraper: ${feError.message}`, "error");
                status.overallSuccess = false;
            }
        }
        logPipeline("--- Finished Step Logic: Companies Scraper ---");
        await delay(10);

        // Step: Postprocess Companies
        logPipeline("--- Evaluating Step: Postprocess Companies ---");
        if (config.stepsToRun.runPostprocessingCompanies) {
            if (!status.companiesScraped) { // Check dependency
                 logPipeline("Step: Skipping Postprocessing Companies (dependency 'Companies Scraper' did not complete).", "warn");
            } else {
                 logPipeline("Step: Running Postprocessing for Companies...");
                 await checkInputFileExists(paths.rawCompanies, "Postprocessing Companies");
                 const success = await postprocessModule.runPostprocessing('companies', paths.rawCompanies, paths.processedCompaniesOutput);
                 if (success) { status.companiesProcessed = true; logPipeline("Step: Postprocessing for Companies finished successfully."); }
                 else { throw new Error("Postprocessing Companies failed."); }
            }
        } else {
            logPipeline("[Skip Logic] Skipping Postprocess Companies (disabled). Checking for existing output...");
            try {
                const exists = await fileExists(paths.processedCompaniesOutput);
                logPipeline(`[Skip Logic] fileExists check for ${paths.processedCompaniesOutput} returned: ${exists}`);
                if (exists) {
                    status.companiesProcessed = true;
                    logPipeline("[Skip Logic] Found existing output file, marking step as complete.");
                } else {
                    logPipeline("[Skip Logic] Output file not found, step remains incomplete.", "warn");
                     if (!status.companiesScraped) status.companiesProcessed = false;
                }
            } catch(feError) {
                logPipeline(`[Skip Logic] Error checking file existence for skipped step Postprocess Companies: ${feError.message}`, "error");
                status.overallSuccess = false;
            }
        }
         logPipeline("--- Finished Step Logic: Postprocess Companies ---");
        await delay(10);

        // Step: Scrape Financial Details
        logPipeline("--- Evaluating Step: Scrape Financial Details ---");
        if (config.stepsToRun.scrapeFinancialDetails) {
             if (!status.companiesProcessed) { // Check dependency
                 logPipeline("Step: Skipping Financial Details Scraping (dependency 'Postprocessing Companies' did not complete).", "warn");
             } else {
                 logPipeline("Step: Scraping Financial Details (Puppeteer)...");
                 await checkInputFileExists(paths.processedCompanies, "Financial Details Scraping");
                 await checkInputFileExists(paths.cookies, "Financial Details Scraping");
                 const success = await financialScraperModule.scrapeFinancialDetails(
                     paths.processedCompanies, paths.cookies, paths.scrapedFinancialsOutput, config.options
                 );
                 if (success) { status.financialsScraped = true; logPipeline("Step: Financial Details Scraping finished successfully."); }
                 else { throw new Error("Financial Details Scraping failed."); }
             }
        } else {
            logPipeline("[Skip Logic] Skipping Financial Details Scraping (disabled). Checking for existing output...");
            try {
                const exists = await fileExists(paths.scrapedFinancialsOutput);
                logPipeline(`[Skip Logic] fileExists check for ${paths.scrapedFinancialsOutput} returned: ${exists}`);
                if (exists) {
                     status.financialsScraped = true;
                     logPipeline("[Skip Logic] Found existing output file, marking step as complete.");
                 } else {
                     logPipeline("[Skip Logic] Output file not found, step remains incomplete.", "warn");
                      if (!status.companiesProcessed) status.financialsScraped = false;
                 }
            } catch(feError) {
                logPipeline(`[Skip Logic] Error checking file existence for skipped step Scrape Financial Details: ${feError.message}`, "error");
                status.overallSuccess = false;
            }
        }
        logPipeline("--- Finished Step Logic: Scrape Financial Details ---");
        await delay(10);

        // Step: Merge Long Format
        logPipeline("--- Evaluating Step: Merge Long Format ---");
        if (config.stepsToRun.runMergingLong) {
            if (!status.companiesProcessed || !status.financialsScraped) {
                logPipeline("Step: Skipping Merging Long (dependency failed).", "warn");
            } else {
                logPipeline("Step: Running Merging (Long Format)...");
                await checkInputFileExists(paths.processedCompanies, "Merging Long");
                await checkInputFileExists(paths.scrapedFinancials, "Merging Long");
                const success = await mergeModule.runMerging(paths.processedCompanies, paths.scrapedFinancials, paths.mergedLongOutput);
                if (success) { status.mergedLong = true; logPipeline("Step: Merging (Long Format) finished successfully."); }
                else { throw new Error("Merging Long Format failed."); }
            }
        } else {
            logPipeline("[Skip Logic] Skipping Merging Long (disabled). Checking for existing output...");
            try {
                const exists = await fileExists(paths.mergedLongOutput);
                logPipeline(`[Skip Logic] fileExists check for ${paths.mergedLongOutput} returned: ${exists}`);
                if (exists) {
                    status.mergedLong = true;
                    logPipeline("[Skip Logic] Found existing output file, marking step as complete.");
                } else {
                    logPipeline("[Skip Logic] Output file not found, step remains incomplete.", "warn");
                     if (!status.companiesProcessed || !status.financialsScraped) status.mergedLong = false;
                }
            } catch(feError) {
                logPipeline(`[Skip Logic] Error checking file existence for skipped step Merge Long: ${feError.message}`, "error");
                status.overallSuccess = false;
            }
        }
        logPipeline("--- Finished Step Logic: Merge Long Format ---");
        await delay(10);

        // Step: Pivot Wide Format
        logPipeline("--- Evaluating Step: Pivot Wide Format ---");
        if (config.stepsToRun.runPivotingWide) {
             if (!status.companiesProcessed || !status.financialsScraped) {
                 logPipeline("Step: Skipping Pivoting Wide (dependency failed).", "warn");
             } else {
                 logPipeline("Step: Running Pivoting (Wide Format)...");
                 await checkInputFileExists(paths.processedCompanies, "Pivoting Wide");
                 await checkInputFileExists(paths.scrapedFinancials, "Pivoting Wide");
                 const success = await pivotModule.runPivoting(paths.processedCompanies, paths.scrapedFinancials, paths.mergedWideOutput);
                 if (success) { status.pivotedWide = true; logPipeline("Step: Pivoting (Wide Format) finished successfully."); }
                 else { throw new Error("Pivoting Wide Format failed."); }
            }
        } else {
            logPipeline("[Skip Logic] Skipping Pivoting Wide (disabled). Checking for existing output...");
            try {
                const exists = await fileExists(paths.mergedWideOutput);
                logPipeline(`[Skip Logic] fileExists check for ${paths.mergedWideOutput} returned: ${exists}`);
                if (exists) {
                      status.pivotedWide = true;
                      logPipeline("[Skip Logic] Found existing output file, marking step as complete.");
                 } else {
                      logPipeline("[Skip Logic] Output file not found, step remains incomplete.", "warn");
                       if (!status.companiesProcessed || !status.financialsScraped) status.pivotedWide = false;
                 }
            } catch(feError) {
                logPipeline(`[Skip Logic] Error checking file existence for skipped step Pivot Wide: ${feError.message}`, "error");
                status.overallSuccess = false;
            }
        }
        logPipeline("--- Finished Step Logic: Pivot Wide Format ---");
        await delay(10);

        // Step: CSV Conversion Long
        logPipeline("--- Evaluating Step: CSV Conversion Long ---");
        if (config.stepsToRun.runCsvConversionLong && config.outputFormats.generateLongFormat) {
            if (!status.mergedLong) { // Check dependency
                 logPipeline("Step: Skipping CSV Conversion Long (dependency failed).", "warn");
            } else {
                logPipeline("Step: Running CSV/XLSX Conversion (Long Format)...");
                await checkInputFileExists(paths.mergedLong, "CSV Conversion Long");
                const success = await csvModule.runConversion(paths.mergedLong, paths.mergedLongCsv, paths.mergedLongXlsx, 'Merged Long');
                if (success) { status.csvLongGenerated = true; logPipeline("Step: CSV/XLSX Conversion (Long Format) finished successfully."); }
                else { throw new Error("CSV Conversion Long failed."); }
            }
        } else {
            logPipeline("Step: Skipping CSV Conversion Long (disabled in config or output formats).");
        }
         logPipeline("--- Finished Step Logic: CSV Conversion Long ---");
        await delay(10);

         // Step: CSV Conversion Wide
        logPipeline("--- Evaluating Step: CSV Conversion Wide ---");
        if (config.stepsToRun.runCsvConversionWide && config.outputFormats.generateWideFormat) {
             if (!status.pivotedWide) { // Check dependency
                 logPipeline("Step: Skipping CSV Conversion Wide (dependency failed).", "warn");
             } else {
                 logPipeline("Step: Running CSV/XLSX Conversion (Wide Format)...");
                 await checkInputFileExists(paths.mergedWide, "CSV Conversion Wide");
                 const success = await csvModule.runConversion(paths.mergedWide, paths.mergedWideCsv, paths.mergedWideXlsx, 'Merged Wide');
                 if (success) { status.csvWideGenerated = true; logPipeline("Step: CSV/XLSX Conversion (Wide Format) finished successfully."); }
                 else { throw new Error("CSV Conversion Wide failed."); }
            }
        } else {
            logPipeline("Step: Skipping CSV Conversion Wide (disabled in config or output formats).");
        }
         logPipeline("--- Finished Step Logic: CSV Conversion Wide ---");
        await delay(10);

        logPipeline("Finished main pipeline steps.");

    } catch (error) {
        console.error("--- ERROR occurred in main pipeline try block ---");
        status.overallSuccess = false;
        if (!error.message.includes("Required input file")) {
           logPipeline(`Pipeline execution failed: ${error.message}`, "error");
        }
        console.error(error.stack);
    } finally {
        console.log("--- Entered main pipeline FINALLY block ---");
    }

    // --- Cleanup ---
    console.log("--- Proceeding to Cleanup ---");
    logPipeline("--- Evaluating Cleanup ---"); // Log before cleanup check
    if (status.overallSuccess && config.options.cleanupIntermediateFiles) {
        logPipeline("Running cleanup of intermediate files...");
        const filesToDelete = [
            { path: paths.processedCompaniesOutput, name: "processed_companies.json", ifStatus: status.companiesProcessed },
            { path: paths.scrapedFinancialsOutput, name: "scraped_financials.jsonl", ifStatus: status.financialsScraped },
            { path: paths.mergedLongOutput, name: "merged_data_long.json", ifStatus: status.mergedLong },
            { path: paths.mergedWideOutput, name: "merged_data_wide.json", ifStatus: status.pivotedWide }
        ];
        for (const file of filesToDelete) {
             if (file.ifStatus) {
                 await deleteFile(file.path, file.name);
             } else {
                  logPipeline(`Skipping deletion of ${file.name} as its generating step did not complete successfully or its output didn't exist when skipped.`, "warn");
             }
         }
        logPipeline("Cleanup finished.");
    } else {
        logPipeline("Skipping cleanup (pipeline failed or disabled in config).");
    }

    // --- Final Status ---
    console.log("--- Proceeding to Final Status ---");
    logPipeline("--- Evaluating Final Status ---"); // Log before final status
    if (status.overallSuccess) {
        logPipeline("Pipeline executed successfully!");
    } else {
        logPipeline("Pipeline finished with errors.", "error");
        process.exitCode = 1;
    }
    logPipeline("--- Pipeline script finished ---"); // Final log
}

console.log("--- About to call runPipeline() ---");
runPipeline(); // Вызов основной функции
console.log("--- runPipeline() called ---"); 