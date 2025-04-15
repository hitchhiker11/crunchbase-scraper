const fs = require("fs");

// --- Logging Utility ---
function logMerge(message) {
    const time = new Date().toISOString();
    console.log(`[${time}] [MERGE_LONG] ${message}`);
}

// --- Function to parse JSONL ---
function parseJsonl(fileContent) {
    if (!fileContent || typeof fileContent !== 'string') {
        return [];
    }
    return fileContent
        .trim() // Remove leading/trailing whitespace
        .split('\n') // Split into lines
        .filter(line => line.trim() !== '') // Remove empty lines
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (e) {
                logMerge(`⚠️ Error parsing JSONL line ${index + 1}: ${e.message}. Line: "${line}"`);
                return null; // Return null for invalid lines
            }
        })
        .filter(obj => obj !== null); // Filter out lines that failed parsing
}

// --- Main Exportable Function ---
async function runMerging(companiesFile, scrapedFinancialsFile, outputFile) {
    logMerge(`Starting data merging process (long format)...`);
    logMerge(`Companies input: ${companiesFile}`);
    logMerge(`Scraped financials input (JSONL): ${scrapedFinancialsFile}`);
    logMerge(`Output file: ${outputFile}`);

    try {
        // --- Load Data ---
        logMerge(`Reading input data...`);
        let companiesData, scrapedFinancialsData;
        try {
            const companiesRaw = await fs.promises.readFile(companiesFile, "utf-8");
            companiesData = JSON.parse(companiesRaw);
            const scrapedFinancialsRaw = await fs.promises.readFile(scrapedFinancialsFile, "utf-8");
            scrapedFinancialsData = parseJsonl(scrapedFinancialsRaw);
        } catch (readErr) {
            logMerge(`❌ Error reading input files: ${readErr.message}`);
            // Check which file failed if possible (e.g., check readErr.path if available)
            if (readErr.path) {
                 logMerge(`Failed file: ${readErr.path}`);
            }
            return false; // Indicate failure
        }


        if (!Array.isArray(companiesData)) {
            throw new Error(`${companiesFile} does not contain a valid JSON array.`);
        }
        if (!Array.isArray(scrapedFinancialsData)) {
            throw new Error(`${scrapedFinancialsFile} does not contain a valid JSON array.`);
        }
        logMerge(`Loaded ${companiesData.length} companies and ${scrapedFinancialsData.length} scraped funding rounds from JSONL.`);

        // --- Group Scraped Rounds by Permalink ---
        logMerge("Grouping scraped funding rounds by organization permalink...");
        const roundsMap = new Map();
        for (const round of scrapedFinancialsData) {
            const orgPermalink = round["Organization Permalink"];
            if (!orgPermalink) {
                logMerge(`⚠️ Scraped round missing "Organization Permalink". Skipping.`);
                continue;
            }
            if (!roundsMap.has(orgPermalink)) {
                roundsMap.set(orgPermalink, []);
            }
            roundsMap.get(orgPermalink).push(round);
        }
        logMerge(`Grouped rounds for ${roundsMap.size} unique permalinks.`);


        // --- Merge Data preserving company order ---
        logMerge("Merging data, preserving company order...");
        const mergedDataLong = [];
        let companiesProcessed = 0;
        let roundsMatchedCount = 0;

        for (const companyInfo of companiesData) {
            companiesProcessed++;
            const companyPermalink = companyInfo["Organization Permalink"];
            const companyRounds = roundsMap.get(companyPermalink) || [];

            const companyFieldsPrefixed = {};
            for (const key in companyInfo) {
                companyFieldsPrefixed[`Company: ${key}`] = companyInfo[key];
            }

            if (companyRounds.length > 0) {
                companyRounds.sort((a, b) => {
                    const dateA = new Date(a["Announced Date"]);
                    const dateB = new Date(b["Announced Date"]);
                    const timeA = !isNaN(dateA.getTime()) ? dateA.getTime() : 0;
                    const timeB = !isNaN(dateB.getTime()) ? dateB.getTime() : 0;
                    return timeB - timeA; // Descending
                });

                for (const round of companyRounds) {
                    mergedDataLong.push({
                        ...companyFieldsPrefixed,
                        ...round
                    });
                    roundsMatchedCount++;
                }
            } else {
                 logMerge(`-> Company ${companyPermalink} (${companyInfo["Organization Name"]}) has no matching scraped funding rounds.`);
            }
        }


        logMerge(`Processed ${companiesProcessed} companies.`);
        logMerge(`Matched and added ${roundsMatchedCount} funding round entries.`);

        // --- Save Output ---
        logMerge(`Saving merged long format data to ${outputFile}...`);
        await fs.promises.writeFile(outputFile, JSON.stringify(mergedDataLong, null, 2), "utf-8");
        logMerge(`✅ Merged long format data successfully saved.`);
        return true; // Indicate success

    } catch (error) {
        logMerge(`❌ An error occurred during merging: ${error.message}`);
        // console.error(error.stack);
        return false; // Indicate failure
    }
}

// --- Export the main function ---
module.exports = {
    runMerging
};

// --- REMOVE direct execution block --- 