const fs = require("fs");
const path = require("path");
// Updated require paths relative to src/
const appModule = require('./modules/app_module.js');
const postprocessModule = require('./modules/postprocess_module.js');
const mergeModule = require('./modules/merge_data_module.js');
const pivotModule = require('./modules/pivot_rounds_module.js');
const csvModule = require('./modules/to_csv_module.js');
const financialScraperModule = require('./modules/financial_scraper_module.js');

// Updated config path relative to project root (where node is run)
const CONFIG_FILE = "config/pipeline_config.json";
const PROJECT_ROOT = process.cwd(); // Get project root directory

// --- Utility Functions ---
function logPipeline(message, level = "info") { /* ... no change ... */ }
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
async function runPipeline() {
    logPipeline("Starting pipeline execution...");

    // 1. Load Configuration
    let config;
    const configPath = path.resolve(PROJECT_ROOT, CONFIG_FILE); // Absolute path to config
    try {
        logPipeline(`Loading configuration from: ${configPath}`);
        const configRaw = await fs.promises.readFile(configPath, "utf-8");
        config = JSON.parse(configRaw);
        logPipeline("Configuration loaded successfully.");
    } catch (err) {
        logPipeline(`Failed to load configuration file ${configPath}: ${err.message}`, "error");
        process.exit(1);
    }

    const status = { // Updated status keys
        companiesScraped: false,
        financialsScraped: false,
        companiesProcessed: false,
        mergedLong: false,
        pivotedWide: false,
        csvLongGenerated: false,
        csvWideGenerated: false,
        overallSuccess: true
    };
    // Paths from config are relative to root, keep them as is
    const paths = { ...config.inputFilePaths, ...config.outputFilePaths };

    // Helper to resolve paths relative to project root before passing to modules
    const resolvePath = (p) => path.resolve(PROJECT_ROOT, p);

    try {
        // --- Step-by-step execution ---

        // Step: Run Companies Scraper
        if (config.stepsToRun.runCompaniesScraper) {
             logPipeline("Step: Running Companies Scraper...");
             await checkInputFileExists(paths.cookies, "Companies Scraper"); // Check required input
             const success = await appModule.runScraper('companies', config); // Pass whole config, module resolves paths it needs
             if (success) {
                 status.companiesScraped = true;
                 logPipeline("Step: Companies Scraper finished successfully.");
             } else { throw new Error("Companies Scraper failed."); }
        } else {
             logPipeline("Step: Skipping Companies Scraper (disabled in config).");
             if (await fileExists(paths.rawCompaniesOutput)) {
                 logPipeline(`Output file ${paths.rawCompaniesOutput} exists, assuming step is complete.`);
                 status.companiesScraped = true;
             } else {
                 logPipeline(`Output file ${paths.rawCompaniesOutput} not found. Subsequent steps depending on it may fail or be skipped.`, "warn");
             }
        }

        // Step: Postprocess Companies
        if (config.stepsToRun.runPostprocessingCompanies) {
            if (!status.companiesScraped) {
                 logPipeline("Step: Skipping Postprocessing Companies (dependency 'Companies Scraper' did not complete successfully).", "warn");
            } else {
                 logPipeline("Step: Running Postprocessing for Companies...");
                 await checkInputFileExists(paths.rawCompanies, "Postprocessing Companies"); // Check required input
                 const success = await postprocessModule.runPostprocessing(
                     'companies',
                     paths.rawCompanies, // Keep passing relative paths from config
                     paths.processedCompaniesOutput // Use specific output path from config
                 );
                 if (success) {
                     status.companiesProcessed = true;
                     logPipeline("Step: Postprocessing for Companies finished successfully.");
                 } else { throw new Error("Postprocessing Companies failed."); }
            }
        } else {
            logPipeline("Step: Skipping Postprocessing Companies (disabled in config).");
            if (await fileExists(paths.processedCompaniesOutput)) {
                 logPipeline(`Output file ${paths.processedCompaniesOutput} exists, assuming step is complete.`);
                 status.companiesProcessed = true;
             } else {
                 logPipeline(`Output file ${paths.processedCompaniesOutput} not found. Subsequent steps depending on it may fail or be skipped.`, "warn");
                 if (!status.companiesScraped) status.companiesProcessed = false;
             }
        }

        // Step: Scrape Financial Details
        if (config.stepsToRun.scrapeFinancialDetails) {
             if (!status.companiesProcessed) {
                 logPipeline("Step: Skipping Financial Details Scraping (dependency 'Postprocessing Companies' did not complete successfully).", "warn");
             } else {
                 logPipeline("Step: Scraping Financial Details (Puppeteer)...");
                 await checkInputFileExists(paths.processedCompanies, "Financial Details Scraping"); // Check required input
                 await checkInputFileExists(paths.cookies, "Financial Details Scraping"); // Check required input
                 const success = await financialScraperModule.scrapeFinancialDetails(
                     paths.processedCompanies,
                     paths.cookies,
                     paths.scrapedFinancialsOutput,
                     config.options
                 );
                 if (success) {
                      status.financialsScraped = true;
                      logPipeline("Step: Financial Details Scraping finished successfully.");
                 } else { throw new Error("Financial Details Scraping failed."); }
             }
        } else {
            logPipeline("Step: Skipping Financial Details Scraping (disabled in config).");
            if (await fileExists(paths.scrapedFinancialsOutput)) {
                 logPipeline(`Output file ${paths.scrapedFinancialsOutput} exists, assuming step is complete.`);
                 status.financialsScraped = true;
            } else {
                 logPipeline(`Output file ${paths.scrapedFinancialsOutput} not found. Subsequent steps depending on it may fail or be skipped.`, "warn");
            }
        }

        // Step: Merge Long Format
        if (config.stepsToRun.runMergingLong) {
            if (!status.companiesProcessed || !status.financialsScraped) {
                logPipeline("Step: Skipping Merging Long (dependency failed).", "warn");
            } else {
                logPipeline("Step: Running Merging (Long Format)...");
                await checkInputFileExists(paths.processedCompanies, "Merging Long");
                await checkInputFileExists(paths.scrapedFinancials, "Merging Long"); // Input is the .jsonl file
                const success = await mergeModule.runMerging(
                    paths.processedCompanies,
                    paths.scrapedFinancials,
                    paths.mergedLongOutput // Specific output path
                );
                if (success) {
                     status.mergedLong = true;
                     logPipeline("Step: Merging (Long Format) finished successfully.");
                 } else { throw new Error("Merging Long Format failed."); }
            }
        } else {
            logPipeline("Step: Skipping Merging Long (disabled in config).");
            if (await fileExists(paths.mergedLongOutput)) {
                 logPipeline(`Output file ${paths.mergedLongOutput} exists, assuming step is complete.`);
                 status.mergedLong = true;
             } else {
                 logPipeline(`Output file ${paths.mergedLongOutput} not found. Subsequent steps depending on it may fail or be skipped.`, "warn");
                 if (!status.companiesProcessed || !status.financialsScraped) status.mergedLong = false;
             }
        }

        // Step: Pivot Wide Format
        if (config.stepsToRun.runPivotingWide) {
            if (!status.companiesProcessed || !status.financialsScraped) {
                logPipeline("Step: Skipping Pivoting Wide (dependency failed).", "warn");
            } else {
                logPipeline("Step: Running Pivoting (Wide Format)...");
                await checkInputFileExists(paths.processedCompanies, "Pivoting Wide");
                await checkInputFileExists(paths.scrapedFinancials, "Pivoting Wide");
                const success = await pivotModule.runPivoting(
                    paths.processedCompanies,
                    paths.scrapedFinancials,
                    paths.mergedWideOutput // Specific output path
                );
                if (success) {
                    status.pivotedWide = true;
                    logPipeline("Step: Pivoting (Wide Format) finished successfully.");
                } else { throw new Error("Pivoting Wide Format failed."); }
            }
        } else {
            logPipeline("Step: Skipping Pivoting Wide (disabled in config).");
            if (await fileExists(paths.mergedWideOutput)) {
                 logPipeline(`Output file ${paths.mergedWideOutput} exists, assuming step is complete.`);
                 status.pivotedWide = true;
            } else {
                 logPipeline(`Output file ${paths.mergedWideOutput} not found. Subsequent steps depending on it may fail or be skipped.`, "warn");
                 if (!status.companiesProcessed || !status.financialsScraped) status.pivotedWide = false;
            }
        }

        // Step: CSV Conversion Long
        if (config.stepsToRun.runCsvConversionLong && config.outputFormats.generateLongFormat) {
            if (!status.mergedLong) {
                 logPipeline("Step: Skipping CSV Conversion Long (dependency failed).", "warn");
            } else {
                logPipeline("Step: Running CSV/XLSX Conversion (Long Format)...");
                await checkInputFileExists(paths.mergedLong, "CSV Conversion Long"); // Input is the merged long json
                const success = await csvModule.runConversion(
                    paths.mergedLong, // Input is the output of the merge step
                    paths.mergedLongCsv,
                    paths.mergedLongXlsx,
                    'Merged Long'
                );
                if (success) {
                    status.csvLongGenerated = true;
                    logPipeline("Step: CSV/XLSX Conversion (Long Format) finished successfully.");
                } else { throw new Error("CSV Conversion Long failed."); }
            }
        } else {
            logPipeline("Step: Skipping CSV Conversion Long (disabled in config or output formats).");
        }

         // Step: CSV Conversion Wide
        if (config.stepsToRun.runCsvConversionWide && config.outputFormats.generateWideFormat) {
            if (!status.pivotedWide) {
                logPipeline("Step: Skipping CSV Conversion Wide (dependency failed).", "warn");
            } else {
                logPipeline("Step: Running CSV/XLSX Conversion (Wide Format)...");
                await checkInputFileExists(paths.mergedWide, "CSV Conversion Wide"); // Input is the merged wide json
                const success = await csvModule.runConversion(
                    paths.mergedWide, // Input is the output of the pivot step
                    paths.mergedWideCsv,
                    paths.mergedWideXlsx,
                    'Merged Wide'
                );
                if (success) {
                     status.csvWideGenerated = true;
                     logPipeline("Step: CSV/XLSX Conversion (Wide Format) finished successfully.");
                 } else { throw new Error("CSV Conversion Wide failed."); }
            }
        } else {
            logPipeline("Step: Skipping CSV Conversion Wide (disabled in config or output formats).");
        }

    } catch (error) {
        status.overallSuccess = false;
        if (!error.message.includes("Required input file")) {
           logPipeline(`Pipeline execution failed: ${error.message}`, "error");
        }
    }

    // --- Cleanup ---
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
                 logPipeline(`Skipping deletion of ${file.name} as its generating step did not complete successfully.`, "warn");
            }
        }
        logPipeline("Cleanup finished.");
    } else if (!status.overallSuccess) {
        logPipeline("Skipping cleanup due to pipeline failure.", "warn");
    } else {
        logPipeline("Skipping cleanup (disabled in config).");
    }

    // --- Final Status ---
    if (status.overallSuccess) {
        logPipeline("Pipeline executed successfully!");
    } else {
        logPipeline("Pipeline finished with errors.", "error");
        process.exitCode = 1;
    }
}

// --- Run the pipeline ---
runPipeline(); 